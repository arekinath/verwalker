var restify = require('restify-clients');
var stream = require('stream');
var util = require('util');
var querystring = require('querystring');
var assert = require('assert-plus');
var vasync = require('vasync');
var streams = require('./streams');
var fs = require('fs');

module.exports = generate;

var GITHUB_USER = process.env.GITHUB_USER;
var GITHUB_KEY = process.env.GITHUB_KEY;

function generate(opts, args) {
	var pkgs = {};
	var repos = {};

	var client = restify.createJsonClient({
		url: 'https://api.github.com'
	});

	client.basicAuth(GITHUB_USER, GITHUB_KEY);

	if (!GITHUB_USER || !GITHUB_KEY) {
		console.error('please set env vars GITHUB_USER and GITHUB_KEY');
		process.exit(1);
	}

	var rls = new streams.RepoListStream(client);
	var fft1 = new streams.FileFetchTransform(client, 'package.json');
	var fft2 = new streams.FileFetchTransform(client, 'Makefile', true);
	var fft3 = new streams.FileFetchTransform(client, '.gitmodules', true);
	var sbt = new streams.SubModulesTransform(client);
	var ppt = new streams.PackageParserTransform();
	rls.pipe(fft1);
	fft1.pipe(fft2);
	fft2.pipe(fft3);
	fft3.pipe(sbt)
	sbt.pipe(ppt);

	ppt.on('readable', function () {
		var pkg;
		while ((pkg = ppt.read())) {
			pkg.dependents = [];
			pkgs[pkg.package.name] = pkg;
			repos[pkg.repository] = pkg.package.name;
		}
	});
	var timer = setInterval(function () {
		console.error('[running] %d repos done, %d packages found (page %d of %s)',
		    fft1.processedCount, ppt.packageCount, rls.page, rls.user);
		fs.writeFileSync(opts['index-file'], JSON.stringify({
			pkgs: pkgs,
			repos: repos
		}));
	}, 2000);
	ppt.on('finish', function () {
		clearInterval(timer);
		console.error('[indexing]');
		fs.writeFileSync(opts['index-file'], JSON.stringify({
			pkgs: pkgs,
			repos: repos
		}));
		makeIndexes();
		fs.writeFileSync(opts['index-file'], JSON.stringify({
			pkgs: pkgs,
			repos: repos
		}));
		console.error('[done]');
		process.exit(0);
	});
	/*var f = JSON.parse(fs.readFileSync(opts['index-file']).toString('utf-8'));
	pkgs = f.pkgs;
	repos = f.repos;
	makeIndexes();
	fs.writeFileSync(opts['index-file'], JSON.stringify({
		pkgs: pkgs,
		repos: repos
	}));
	console.error('[done]');
	process.exit(0);*/

	function makeIndexes() {
		Object.keys(pkgs).forEach(function (k) {
			var pkg = pkgs[k];
			var deps = pkg.package.dependencies;
			if (!deps)
				return;
			Object.keys(deps).forEach(function (dk) {
				var dv = deps[dk];
				if (!pkgs[dk]) {
					pkgs[dk] = {
						package: {
							name: dk,
							dependencies: {}
						},
						dependents: []
					};
				}
				var dps = pkgs[dk].dependents;
				if (dps.indexOf(pkg.package.name) === -1)
					dps.push(pkg.package.name);
				var re = new RegExp(
				    'github.com[:/]([^/.#]+/[^/.#]+)' +
				    '(\\.git)?(#.*)?$');
				var m = dv.match(re);
				if (m && repos[m[1]]) {
					var otherPkg = pkgs[repos[m[1]]];
					var dps = otherPkg.dependents;
					if (dps.indexOf(pkg.package.name) === -1)
						dps.push(pkg.package.name);
					delete (deps[dk]);
					deps[otherPkg.package.name] = m[3] || '#master';
				}
			});
		});
	}
}
