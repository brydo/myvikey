(function () {
    'use strict';

    var headers = ['Name', 'Event', 'Attending', 'Additional Guests', 'Notes', 'Event ID', 'Submitted at (UTC)'];

    function rows(replies) {
        return [headers].concat(replies.map(function (reply) {
            return [reply.name, reply.event, reply.attending === 'yes' ? 'Yes' : 'No',
                reply.guests, reply.notes || '', reply.eventId || '', reply.createdAt || ''];
        }));
    }

    function csv(replies) {
        return '\ufeff' + rows(replies).map(function (row) {
            return row.map(function (value) {
                var text = String(value == null ? '' : value);
                // Quoting alone does not prevent spreadsheet formula injection.
                if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
                return '"' + text.replace(/"/g, '""') + '"';
            }).join(',');
        }).join('\r\n') + '\r\n';
    }

    function xml(value) {
        return Array.from(String(value == null ? '' : value)).filter(function (character) {
            var code = character.codePointAt(0);
            return code === 9 || code === 10 || code === 13 ||
                (code >= 32 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || code >= 0x10000;
        }).join('').replace(/[&<>"']/g, function (character) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character];
        });
    }

    function sheet(replies) {
        return '<?xml version="1.0" encoding="UTF-8"?>' +
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
            rows(replies).map(function (row) {
                return '<row>' + row.map(function (value) {
                    // Inline strings keep guest-supplied values as text, never formulas.
                    return typeof value === 'number' ? '<c><v>' + value + '</v></c>' :
                        '<c t="inlineStr"><is><t xml:space="preserve">' + xml(value) + '</t></is></c>';
                }).join('') + '</row>';
            }).join('') + '</sheetData></worksheet>';
    }

    function zip(files) {
        var encoder = new TextEncoder();
        var parts = [];
        var directory = [];
        var offset = 0;
        var directorySize = 0;
        if (files.length > 65535) throw new Error('Too many events for one workbook.');
        files.forEach(function (file) {
            var name = encoder.encode(file[0]);
            var data = encoder.encode(file[1]);
            var crc = 0xffffffff;
            data.forEach(function (byte) {
                crc ^= byte;
                for (var bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
            });
            crc = (crc ^ 0xffffffff) >>> 0;
            var local = new Uint8Array(30 + name.length);
            var view = new DataView(local.buffer);
            view.setUint32(0, 0x04034b50, true);
            view.setUint16(4, 20, true);
            view.setUint16(6, 0x0800, true);
            view.setUint16(12, 33, true);
            view.setUint32(14, crc, true);
            view.setUint32(18, data.length, true);
            view.setUint32(22, data.length, true);
            view.setUint16(26, name.length, true);
            local.set(name, 30);
            var central = new Uint8Array(46 + name.length);
            view = new DataView(central.buffer);
            view.setUint32(0, 0x02014b50, true);
            view.setUint16(4, 20, true);
            view.setUint16(6, 20, true);
            view.setUint16(8, 0x0800, true);
            view.setUint16(14, 33, true);
            view.setUint32(16, crc, true);
            view.setUint32(20, data.length, true);
            view.setUint32(24, data.length, true);
            view.setUint16(28, name.length, true);
            view.setUint32(42, offset, true);
            central.set(name, 46);
            parts.push(local, data);
            directory.push(central);
            offset += local.length + data.length;
            directorySize += central.length;
        });
        var end = new Uint8Array(22);
        var view = new DataView(end.buffer);
        view.setUint32(0, 0x06054b50, true);
        view.setUint16(8, files.length, true);
        view.setUint16(10, files.length, true);
        view.setUint32(12, directorySize, true);
        view.setUint32(16, offset, true);
        return new Blob(parts.concat(directory, [end]));
    }

    function workbook(invitations, replies) {
        var groups = new Map();
        invitations.forEach(function (item) { groups.set(item.id, { title: item.title, replies: [] }); });
        replies.forEach(function (reply) {
            var id = reply.eventId || '';
            if (!groups.has(id)) groups.set(id, { title: id ? reply.event || id : 'Unassigned', replies: [] });
            groups.get(id).replies.push(reply);
        });
        if (!groups.size) groups.set('', { title: 'Unassigned', replies: [] });
        var used = new Set();
        var sheets = [];
        var files = [];
        groups.forEach(function (group) {
            var base = String(group.title || 'Event').replace(/[\\/*?:[\]\u0000-\u001f]/g, ' ').trim()
                .replace(/^'+|'+$/g, '').slice(0, 31).replace(/'+$/g, '') || 'Event';
            var name = base;
            var suffix = 1;
            while (used.has(name.toLowerCase()) || name.toLowerCase() === 'history') {
                var ending = ' (' + (++suffix) + ')';
                name = base.slice(0, 31 - ending.length) + ending;
            }
            used.add(name.toLowerCase());
            var index = sheets.length + 1;
            sheets.push('<sheet name="' + xml(name) + '" sheetId="' + index + '" r:id="rId' + index + '"/>');
            files.push(['xl/worksheets/sheet' + index + '.xml', sheet(group.replies)]);
        });
        var ns = 'http://schemas.openxmlformats.org/';
        var relationships = files.map(function (_, index) {
            return '<Relationship Id="rId' + (index + 1) + '" Type="' + ns +
                'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (index + 1) + '.xml"/>';
        }).join('');
        var types = files.map(function (file) {
            return '<Override PartName="/' + file[0] + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }).join('');
        files.push(
            ['[Content_Types].xml', '<Types xmlns="' + ns + 'package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                '<Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + types + '</Types>'],
            ['_rels/.rels', '<Relationships xmlns="' + ns + 'package/2006/relationships">' +
                '<Relationship Id="rId1" Type="' + ns + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
            ['xl/workbook.xml', '<workbook xmlns="' + ns + 'spreadsheetml/2006/main" xmlns:r="' + ns +
                'officeDocument/2006/relationships"><sheets>' + sheets.join('') + '</sheets></workbook>'],
            ['xl/_rels/workbook.xml.rels', '<Relationships xmlns="' + ns + 'package/2006/relationships">' + relationships + '</Relationships>']
        );
        return zip(files);
    }

    function download(content, filename, type) {
        var url = URL.createObjectURL(new Blob([content], { type: type }));
        var link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    window.RSVPExport = { csv: csv, workbook: workbook, download: download };
})();
