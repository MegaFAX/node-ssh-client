const {EventEmitter} = require(`events`);
const net = require(`net`);
const path = require(`path`);
const {createInterface, emitKeypressEvents} = require(`readline`);
const {Client} = require(`ssh2`);
const {generateCallback, log} = require(`./helpers`);

class SSH extends EventEmitter {
	constructor() {
		super();

		this.stdin = process.stdin;
		this.stdout = process.stdout;
		this.stderr = process.stderr;
		this.ssh = new Client();

		this.command = '';

		this.cwd = '';
		this.homedir = '/';

		this.host = `127.0.0.1`;
		this.port = 22;

		this.rl = createInterface({
			input: this.stdin,
			output: this.stdout,
			terminal: true,
			historySize: 1000,
			removeHistoryDuplicates: true,
			prompt: ''
		});

		emitKeypressEvents(this.stdin);
		this.stdin.setRawMode(true);

		this.prevSIGINT = false;
	}

	async connect({host, port, username, password, localForward, remoteForward}) {
		log(`Connecting to ${ host }:${ port }...`);

		this.host = host;
		this.port = port;
		this.localForward = localForward;
		this.remoteForward = remoteForward;

		this.bindSSH();

		try {
			this.ssh.connect({host, port, username, password});
		}
		catch (e) {
			log(e.message, this.stderr);
			this.emit('end');
		}
	}

	bindSSH() {
		this.ssh.on(`error`, (err) => {
			log(err, stderr);
		});

		this.ssh.on(`ready`, async () => {
			log(`Connection successful.`);

			if (this.localForward) {
				await this.forwardOut(this.localForward);
			}

			if (this.remoteForward) {
				await this.forwardIn(this.remoteForward);
			}

			this.homedir = (await this.exec('echo $HOME')).toString().trim();

			this.ssh.shell((err, stream) => {
				if (err) {
					throw err;
				}

				this.rl.on('line', async (data) => {
					this.command = data.toString().replace(/\t/g, '').trim();

					if (/^get\s+(.*?)$/.test(this.command)) {
						let [, remoteFile] = /^get\s+(.*?)$/.exec(this.command);
						await this.getFile(remoteFile);

						stream.write('\n');
					}
					else if (/^put\s+(.*?)$/.test(this.command)) {
						let [, localFile] = /^put\s+(.*?)$/.exec(this.command);
						await this.putFile(localFile);

						stream.write('\n');
					}
					else {
						// TODO переделать чтобы стиралась прошлая команда
						// stream.write('\u0008\u0000'.repeat(this.command.length));
						stream.write(`${ this.command }\n`);
					}

					this.prevSIGINT = false;
				});

				this.rl.on('SIGINT', () => {
					this.stdin.pause();
					stream.write('\u0003');
					this.stdin.resume();
				});

				this.stdin.on('keypress', (str, key) => {
					this.stdin.pause();
					if (key.name === 'tab') {
						stream.write(`${ this.command }\t\t`);
						this.prevSIGINT = false;
					}
					else if (key.name === 'backspace') {
						this.command = this.command.slice(0, -1);
						this.prevSIGINT = false;
					}
					else if (key.ctrl && key.name === 'c') {
						this.stdout.write('\n');
						if (!this.prevSIGINT) {
							this.prevSIGINT = true;
						}
						else {
							stream.write('exit\n');
						}
					}

					if (key.name === key.sequence) {
						this.command += str;
					}
					this.stdin.resume();
				});

				stream.on('close', () => {
					log('Connection closed.');
					this.ssh.end();
					this.emit('end');
				});

				stream.on('data', (data) => {
					let regexp = /^((\S+?@)?\S+?:(\S+?))(#|\$)\s?(.*)?$/i;

					if (data.toString().trim() !== this.command) {
						if (regexp.test(data.toString().trim())) {
							let [prompt, , , relPath, , command] = regexp.exec(data.toString().trim());
							this.rl.setPrompt(`${ prompt } `);
							this.cwd = relPath.replace(/^~/, this.homedir);
							this.command = command;
						}

						this.stdin.pause();
						this.stdout.write(data.toString().replace(/\t/g, ''));
						//this.stdout.write(data);
						this.stdin.resume();
					}
					else {
						this.command = '';
					}
				});

				stream.stderr.on('data', (data) => {
					this.stderr.write(data);
				});

			});
		});
	}

	async openSFTP() {
		return new Promise((resolve, reject) => {
			this.ssh.sftp(generateCallback(resolve, reject));
		});
	}

	async getFile(remoteFile) {
		remoteFile = path.posix.resolve(this.cwd, remoteFile);
		let {base: localFile} = path.parse(remoteFile);
		localFile = path.join(path.resolve(__dirname, '..', localFile));

		let sftp = await this.openSFTP();

		try {
			this.stdout.write(`\n`);
			log(`Downloading ${ this.host }:${ this.port }:${ remoteFile } to 127.0.0.1:${ localFile }`);
			await new Promise((resolve, reject) => {
				sftp.fastGet(remoteFile, localFile, generateCallback(resolve, reject));
			});
			log(`File is downloaded successfully`);
		}
		catch (e) {
			log(e.message, this.stderr);
		}
		finally {
			sftp.end();
		}
	}

	async putFile(localFile) {
		localFile = path.normalize(path.resolve(__dirname, '..', localFile));
		let {base: remoteFile} = path.parse(localFile);
		remoteFile = path.posix.resolve(this.cwd, remoteFile);
		let sftp = await this.openSFTP();

		try {
			this.stdout.write(`\n`);
			log(`Uploading 127.0.0.1:${ localFile } to ${ this.host }:${ this.port }:${ remoteFile }`);
			await new Promise((resolve, reject) => {
				sftp.fastPut(localFile, remoteFile, {cwd: this.cwd}, generateCallback(resolve, reject));
			});
			log(`File is uploaded successfully`);
		}
		catch (e) {
			log(e.message, this.stderr);
		}
		finally {
			sftp.end();
		}
	}

	async exec(command) {
		return await new Promise((resolve, reject) => {
			this.ssh.exec(command, generateCallback((stream) => {
				stream.on('data', (data) => {
					resolve(data);
					stream.end();
				});

				stream.on('error', (err) => reject(err));
				stream.stderr.on('data', (data) => reject(data));
			}, reject));
		});
	}

	// [-L [address:]port:host:hostport]
	async forwardOut({address, port, host, hostport}) {
		return await new Promise((resolve, reject) => {
			log(`Open local port forward from ${ address }:${ port } to ${ host }:${ hostport }`);
			this.ssh.forwardOut(address, port, host, hostport, generateCallback((stream) => {
				log(`Local port forwarding opened`);

				let server = new net.Server();

				server.listen(port, address);

				server.on('connection', (socket) => {
					stream.pipe(socket);
					socket.pipe(stream);
				});

				stream.on('error', (err) => reject(err));
				stream.stderr.on('data', (data) => reject(data));

				resolve(stream);
			}, reject));
		});
	}

	// [-R [address:]port:host:hostport]
	async forwardIn({address, port, host, hostport}) {
		return await new Promise((resolve, reject) => {
			log(`Open remote port forward from ${ host }:${ hostport } to ${ address }:${ port }`);
			this.ssh.forwardIn(host, hostport, generateCallback((localport) => {
				log(`Remote port forwarding opened for localport ${ localport }`);

				let socket = new net.Socket();
				socket.connect(port, host);

				this.ssh.on('tcp connection', (info, accept, reject) => {
					let stream = accept();
					stream.pipe(socket);
					socket.pipe(stream);
				});

				resolve(port);
			}, reject));
		});
	}
}

module.exports = SSH;