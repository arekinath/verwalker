var restify = require('restify-clients');
var stream = require('stream');
var util = require('util');
var querystring = require('querystring');
var assert = require('assert-plus');
var vasync = require('vasync');

module.exports = {
	RepoListStream: RepoListStream,
	PackageParserTransform: PackageParserTransform,
	FileFetchTransform: FileFetchTransform,
	FileNotFoundError: FileNotFoundError
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

var NP_REGEX = /^\s*NODE_PREBUILT_([A-Z]+)\s*[:=?]+\s*(.+)$/;

function PackageParserTransform() {
	this.processedCount = 0;
	this.packageCount = 0;
	stream.Transform.call(this, {
		readableObjectMode: true,
		writableObjectMode: true
	});
}
util.inherits(PackageParserTransform, stream.Transform);
PackageParserTransform.prototype._transform = function (obj, enc, callback) {
	var repo = obj.full_name;
	var self = this;
	var result = {repository: repo};

	++self.processedCount;

	var pkg;
	try {
		pkg = JSON.parse(obj['package.json'].data.toString('utf-8'));
	} catch (e) {
		callback();
		return;
	}
	result.package = pkg;

	if (obj['Makefile'] && obj['Makefile'].data) {
		var mk = obj['Makefile'].data.toString('utf-8');
		mk.split('\n').forEach(function (line) {
			var m = line.match(NP_REGEX);
			if (m && m[1] === 'VERSION') {
				result.node_version = m[2];
			} else if (m && m[1] === 'IMAGE') {
				result.base_image = m[2];
			}
		});
	}

	++this.packageCount;
	this.push(result);
	callback();
};

function FileFetchTransform(client, filename, ignore) {
	this.client = client;
	this.processedCount = 0;
	this.foundCount = 0;
	this.filename = filename;
	this.ignore = ignore;
	stream.Transform.call(this, {
		readableObjectMode: true,
		writableObjectMode: true
	});
}
util.inherits(FileFetchTransform, stream.Transform);
FileFetchTransform.prototype._transform = function (obj, enc, callback) {
	var repo = obj.full_name;
	var self = this;
	var result = {};
	obj[this.filename] = result;

	++self.processedCount;

	vasync.pipeline({
		funcs: [dereference, getCommit, getTree, getBlob]
	}, function afterPipeline(err, res) {
		if (err && !self.ignore) {
			if (err instanceof FileNotFoundError ||
			    err.ase_errors && err.ase_errors.length === 1 &&
			    err.ase_errors[0] instanceof FileNotFoundError) {
				callback();
				return;
			}
			callback(err);
			return;
		}
		if (!err)
			++self.foundCount;
		self.push(obj);
		callback();
	});

	function dereference(_, cb) {
		self.client.get('/repos/' + repo + '/git/refs/heads/master',
		    function (err, req, res, obj) {
			if (err && (err.name === 'NotFoundError' ||
			    err.message.match(/is empty/))) {
				var e = new FileNotFoundError(repo);
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
				    blob.path === self.filename);
			});
			if (blobs.length !== 1) {
				var e = new FileNotFoundError(repo);
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
			result.data = buf;
			cb();
		});
	}
};

function FileNotFoundError(repo, filename) {
	this.repo = repo;
	this.filename = filename;
	Error.call(this, 'No file named `' + filename + '` in ' + repo);
}
util.inherits(FileNotFoundError, Error);

