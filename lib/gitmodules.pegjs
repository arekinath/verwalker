file = bs:(comment / block / empty)* {
	bs = bs.filter(function (b) {
		return (b.name !== undefined);
	});
	return (bs);
}
block = h:header kvs:line* {
	kvs.forEach(function (kv) {
		if (!kv.key)
			return;
		h[kv.key] = kv.value;
	});
	return (h);
}
line = comment / kvline / empty
empty = "\n" / (sp "\n") {
	return ({});
}
comment = "#" [^\n]* "\n" {
	return ({});
}
header = "[submodule" sp n:quotestr "]" "\n" {
	return ({name: n});
}
kvline = sp k:kvkey sp "=" sp v:kvvalue "\n" {
	return ({key: k, value: v});
}
kvkey = [^ =]* { return (text()); }
kvvalue = v:quotestr / (v:rawvalue ("#" [^\n]*)?) {
	return (v);
}
rawvalue = [^\n#]* { return (text().trim()); }
sp = [ \t]+
quotestr = "\"" t:inquote "\"" {
	return (t);
}
inquote = parts:(([^\\"]+ { return (text()); }) / escape)* {
	return (parts.join(''));
}
escape = "\\" esc:["nt] {
	switch (esc) {
	case '"':
		return (esc);
	case 'n':
		return ("\n");
	case 't':
		return ("\t");
	}
}
