var util = require('util');
var assert = require('assert-plus');

module.exports = deps;

function deps(opts, args, index) {
	if (args.length !== 1) {
		console.error('usage: verwalker deps <package name | repo>');
		process.exit(1);
	}
	var pkg = index.pkgs[args[0]];
	if (!pkg)
		pkg = index.pkgs[index.repos[args[0]]];
	if (!pkg) {
		console.error('failed to find package or repo "%s"', args[0]);
		process.exit(1);
	}
	var deps = pkg.package.dependencies;
	Object.keys(deps).sort().forEach(function (dk) {
		var dv = deps[dk];
		var sep = '\t';
		if (dk.length < 8)
			sep += '\t';
		if (dk.length < 16)
			sep += '\t';
		console.log("%s%s%s", dk, sep, dv);
	});
	process.exit(0);
}
