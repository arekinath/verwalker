var util = require('util');
var assert = require('assert-plus');
var semver = require('semver');

module.exports = revdeps;

function revdeps(opts, args, index) {
	if (args.length !== 1) {
		console.error('usage: verwalker revdeps <package name | repo>');
		process.exit(1);
	}
	var dps;
	if (args[0] === 'node') {
		dps = Object.keys(index.pkgs);
	} else {
		var pkg = index.pkgs[args[0]];
		if (!pkg)
			pkg = index.pkgs[index.repos[args[0]]];
		if (!pkg) {
			console.error('failed to find package or repo "%s"',
			    args[0]);
			process.exit(1);
		}
		dps = pkg.dependents;
	}
	var vers = [];
	dps.forEach(function (dp) {
		var otherPkg = index.pkgs[dp];
		var ver;
		if (args[0] === 'node') {
			if (otherPkg.node_version)
				ver = otherPkg.node_version.slice(1);
			else
				return;
		} else {
			var ver = otherPkg.package.
			    dependencies[pkg.package.name];
		}
		var nm = otherPkg.package.name;
		var repo = otherPkg.repository;
		vers.push({nm: nm, repo: repo, ver: ver});
	});
	vers.sort(function (a,b) {
		if (semver.valid(a.ver) && semver.valid(b.ver))
			return (semver.compare(a.ver, b.ver));
		if (semver.valid(a.ver) && semver.validRange(b.ver)) {
			if (semver.ltr(a.ver, b.ver))
				return (-1);
			if (semver.gtr(a.ver, b.ver))
				return (1);
		}
		if (semver.validRange(a.ver) && semver.valid(b.ver)) {
			if (semver.ltr(b.ver, a.ver))
				return (1);
			if (semver.gtr(b.ver, a.ver))
				return (-1);
		}
		if (a.ver > b.ver)
			return (1);
		if (a.ver < b.ver)
			return (-1);
		return (0);
	});
	vers.forEach(function (v) {
		var sep1 = '\t';
		if (v.nm.length < 8)
			sep1 += '\t';
		if (v.nm.length < 16)
			sep1 += '\t';
		var sep2 = '\t';
		if (v.repo.length < 8)
			sep2 += '\t';
		if (v.repo.length < 16)
			sep2 += '\t';
		if (v.repo.length < 24)
			sep2 += '\t';
		console.log('%s%s%s%s%s', v.nm, sep1, v.repo, sep2, v.ver);
	});
	process.exit(0);
}
