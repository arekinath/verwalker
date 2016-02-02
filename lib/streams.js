var restify = require('restify-clients');
var stream = require('stream');
var util = require('util');
var querystring = require('querystring');
var assert = require('assert-plus');
var vasync = require('vasync');

module.exports = {
	RepoListStream: RepoListStream,
	PackageJsonTransform: PackageJsonTransform,
	NotPackageError: NotPackageError
};

var USER = 'joyent';

function RepoListStream(client) {
	this.client = client;
	this.page = 1;
	this.per_page = 100;
	this.fetching = false;
	stream.Readable.call(this, {
		objectMode: true
	});
}
util.inherits(RepoListStream, stream.Readable);
RepoListStream.prototype._read = function (size) {
	if (this.fetching)
		return;

	this.fetching = true;
	var self = this;
	var qs = querystring.stringify({
		per_page: this.per_page,
		page: this.page
	});
	this.client.get('/users/' + USER + '/repos?' + qs, 
	    function (err, req, res, objs) {
		if (err) {
			console.error('error listing repos: ' + err.name +
			    ': ' + err.message)
			process.exit(1);
		}

		if (objs.length === 0) {
			self.push(null);
			return;
		}

		++self.page;
		self.fetching = false;

		assert.arrayOfObject(objs);
		objs.forEach(function (obj) {
			assert.object(obj);
			assert.string(obj.full_name);
			self.push(obj);
		});
	});
};

function PackageJsonTransform(client) {
	this.client = client;
	this.repoCount = 0;
	this.packageCount = 0;
	stream.Transform.call(this, {
		readableObjectMode: true,
		writableObjectMode: true
	});
}
util.inherits(PackageJsonTransform, stream.Transform);
PackageJsonTransform.prototype._transform = function (obj, enc, callback) {
	var repo = obj.full_name;
	var self = this;
	var result = {repository: repo};

	++self.repoCount;

	vasync.pipeline({
		funcs: [dereference, getCommit, getTree, getBlob]
	}, function afterPipeline(err, res) {
		if (err) {
			if (err instanceof NotPackageError ||
			    err.ase_errors && err.ase_errors.length === 1 &&
			    err.ase_errors[0] instanceof NotPackageError) {
				callback();
				return;
			}
			callback(err);
			return;
		}
		++self.packageCount;
		self.push(result);
		callback();
	});

	function dereference(_, cb) {
		self.client.get('/repos/' + repo + '/git/refs/heads/master',
		    function (err, req, res, obj) {
		    	if (err && (err.name === 'NotFoundError' ||
		    	    err.message.match(/is empty/))) {
		    		var e = new NotPackageError(repo);
				cb(e);
				return;
		    	}
			if (err) {
				e = new Error('Error while dereferencing master for ' + repo + ': ' + err.name + ': ' + err.message);
				cb(e);
				return;
			}
			assert.object(obj);
			assert.object(obj.object);
			assert.string(obj.object.sha);
			result.commit = obj.object.sha;
			cb();
		});
	}

	function getCommit(_, cb) {
		self.client.get('/repos/' + repo + '/git/commits/' +
		    result.commit, function (err, req, res, obj) {
			if (err) {
				var e = new Error('Error while fetching commit ' + result.commit + ' in ' + repo + ': ' + err.name + ': ' + err.message);
				cb(e);
				return;
			}
			assert.object(obj);
			assert.object(obj.tree);
			assert.string(obj.tree.sha);
			result.tree = obj.tree.sha;
			cb();
		});
	}

	function getTree(_, cb) {
		self.client.get('/repos/' + repo + '/git/trees/' + result.tree,
		    function (err, req, res, obj) {
			if (err) {
				var e = new Error('Error while fetching tree ' + result.tree + ' in ' + repo + ': ' + err.name + ': ' + err.message);
				cb(e);
				return;
			}
			assert.object(obj);
			assert.arrayOfObject(obj.tree);
			assert.ok(!obj.truncated);
			var blobs = obj.tree.filter(function (blob) {
				return (blob.type === 'blob' &&
				    blob.path === 'package.json');
			});
			if (blobs.length !== 1) {
				var e = new NotPackageError(repo);
				cb(e);
				return;
			}
			assert.string(blobs[0].sha);
			result.blob = blobs[0].sha;
			cb();
		});
	}

	function getBlob(_, cb) {
		self.client.get('/repos/' + repo + '/git/blobs/' + result.blob,
		    function (err, req, res, obj) {
			if (err) {
				var e = new Error('Error while fetching blob ' + result.blob + ' in ' + repo + ': ' + err.name + ': ' + err.message);
				cb(e);
				return;
			}
			assert.object(obj);
			assert.string(obj.content);

			var buf = new Buffer(obj.content, 'base64');

			var pkg = JSON.parse(buf.toString('utf-8'));
			result.package = pkg;
			cb();
		});
	}
};

function NotPackageError(repo) {
	this.repo = repo;
	Error.call(this, 'No package.json found in repo ' + repo);
}
util.inherits(NotPackageError, Error);
