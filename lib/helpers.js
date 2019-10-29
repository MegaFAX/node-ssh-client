function generateCallback(resolve, reject) {
	return function(error, result) {
		if (error) {
			reject(error);
		}
		else {
			resolve(result);
		}
	};
}

const log = (data, stdout = process.stdout) => {
	let date = new Date();
	let [hours, minutes, seconds] = [
		date.getHours() < 10 ? `0${ date.getHours() }` : `${ date.getHours() }`,
		date.getMinutes() < 10 ? `0${ date.getMinutes() }` : `${ date.getMinutes() }`,
		date.getSeconds() < 10 ? `0${ date.getSeconds() }` : `${ date.getSeconds() }`
	];
	stdout.write(`[${ hours }:${ minutes }:${ seconds }] ${ data }\n`);
};

module.exports = {
	generateCallback,
	log
};