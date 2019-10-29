const SSH = require(`lib/ssh.class`);
const ssh = new SSH();

let args = process.argv.slice(2);
let options = {
	host: '127.0.0.1',
	port: 22,
	username: 'root',
	password: '',
	localForward: null,
	remoteForward: null
};

for (let i = 0; i < args.length; i++) {
	if (args[i] === '-L') {
		i++;
		let regexp = /^((.*?):)?(\d+?):(.*?):(\d+?)$/i;
		if (!regexp.test(args[i])) {
			console.error('Wrong params for -L');
			process.exit();
		}

		let [, , address = '127.0.0.1', port, host, hostport] = regexp.exec(args[i]);
		options.localForward = {address, port, host, hostport};
	}
	else if (args[i] === '-R') {
		i++;
		let regexp = /^((.*?):)?(\d+?):(.*?):(\d+?)$/i;
		if (!regexp.test(args[i])) {
			console.error('Wrong params for -R');
			process.exit();
		}

		let [, , address = '127.0.0.1', port, host, hostport] = regexp.exec(args[i]);
		options.remoteForward = {address, port, host, hostport};
	}
	else {
		let regexp = /^(\S+?):(\S+?)@(\S+?)(:(\d+))?$/i;
		if (!regexp.test(args[i])) {
			console.error('Wrong connection string');
			process.exit();
		}

		let [, username, password, host, , port] = regexp.exec(args[i]);

		options = {...options, username, password, host, port};
	}
}

ssh.connect(options)
   .catch(console.error);

ssh.on('end', () => process.exit());