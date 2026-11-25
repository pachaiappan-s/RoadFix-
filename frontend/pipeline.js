(function () {
  var STATUSES = ['Reported', 'Verified', 'Assigned', 'Fixed'];
  var pipeline = document.getElementById('pipeline');
  if (!pipeline) return;

  var panel = document.createElement('section');
  panel.className = 'card';
  panel.id = 'pipelineDetail';
  panel.style.display = 'none';
  pipeline.closest('section').insertAdjacentElement('afterend', panel);

  function cell(row, text) {
    var td = document.createElement('td');
    td.textContent = (text === undefined || text === null || text === '') ? '-' : text;
    row.appendChild(td);
    return td;
  }

  function shortDate(v) {
    return (typeof v === 'string' && v.length >= 10) ? v.slice(0, 10) : v;
  }

  function link(label, href) {
    var a = document.createElement('a');
    a.className = 'row-link';
    a.textContent = label;
    a.href = href;
    a.target = '_blank';
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    return a;
  }

  /* NEW: photo link that opens a popup instead of a blank 404 page */
  function photoLink(id) {
    var a = document.createElement('a');
    a.className = 'row-link';
    a.href = '#';
    a.textContent = 'Photo';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      fetch('/api/tickets/' + id + '/photo')
        .then(function (r) {
          if (!r.ok) { throw new Error('missing'); }
          return r.blob();
        })
        .then(function (blob) { showPhoto(URL.createObjectURL(blob)); })
        .catch(function () { showPhoto(null); });
    });
    return a;
  }
function detectedPhotoLink(id) {
  var a = document.createElement('a');
  a.className = 'row-link';
  a.href = '#';
  a.textContent = 'AI Detection';

  a.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();

    fetch('/api/tickets/' + id + '/detected-photo')
      .then(function (r) {
        if (!r.ok) throw new Error('missing');
        return r.blob();
      })
      .then(function (blob) {
        showPhoto(URL.createObjectURL(blob));
      })
      .catch(function () {
        showPhoto(null);
      });
  });

  return a;
}
  /* NEW: popup that shows the photo, or a message if the file is missing */
  function showPhoto(src) {
    var old = document.getElementById('photoModal');
    if (old) { old.remove(); }

    var modal = document.createElement('div');
    modal.id = 'photoModal';
    modal.className = 'photo-modal';

    var box = document.createElement('div');
    box.className = 'photo-box';

    if (src) {
      var img = document.createElement('img');
      img.src = src;
      img.alt = 'Citizen photo';
      box.appendChild(img);
    } else {
      var p = document.createElement('p');
      p.textContent = 'No photo file is stored for this ticket.';
      box.appendChild(p);
    }

    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', function () { modal.remove(); });
    box.appendChild(close);

    modal.appendChild(box);
    modal.addEventListener('click', function (e) { if (e.target === modal) { modal.remove(); } });
    document.body.appendChild(modal);
  }

  function render(status, tickets) {
    panel.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'panel-head';
    var h2 = document.createElement('h2');
    h2.textContent = status + ' tickets (' + tickets.length + ')';
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', function () {
      panel.style.display = 'none';
      Array.prototype.forEach.call(pipeline.children, function (c) { c.classList.remove('active'); });
    });
    head.appendChild(h2);
    head.appendChild(close);
    panel.appendChild(head);

    if (!tickets.length) {
      var empty = document.createElement('p');
      empty.style.color = 'var(--text-muted)';
      empty.textContent = 'No tickets with this status.';
      panel.appendChild(empty);
      return;
    }

    var wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    var table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Ticket</th><th>Road</th><th>Damage</th><th>Severity</th>' +
      '<th>Reports</th><th>Priority</th><th>Reported on</th><th>Files</th></tr></thead>';
    var tbody = document.createElement('tbody');

    tickets.forEach(function (t) {
      var tr = document.createElement('tr');
      cell(tr, t.ticket_code);
      cell(tr, t.road_name);
      cell(tr, t.damage_type);

      var sev = cell(tr, '');
      if (t.severity) {
        sev.textContent = '';
        var s = document.createElement('span');
        s.className = t.severity;
        s.textContent = t.severity;
        sev.appendChild(s);
      }

      cell(tr, t.report_count);
      cell(tr, t.priority);
      cell(tr, shortDate(t.first_reported));

      var files = cell(tr, '');
      files.textContent = '';
      if (t.id) {
        files.appendChild(photoLink(t.id));
        files.appendChild(detectedPhotoLink(t.id));
        files.appendChild(link('PDF', '/api/tickets/' + t.id + '/pdf'));
      }
      tbody.appendChild(tr);

      var detail = document.createElement('tr');
      detail.style.display = 'none';
      var dtd = document.createElement('td');
      dtd.colSpan = 8;
      var grid = document.createElement('div');
      grid.className = 'detail-grid';
      Object.keys(t).forEach(function (k) {
        if (k === 'photo_path') return;
        var item = document.createElement('div');
        var key = document.createElement('span');
        key.className = 'k';
        key.textContent = k.replace(/_/g, ' ');
        var val = document.createElement('span');
        var v = t[k];
        val.textContent = (v === null || v === undefined || v === '') ? '-' : (typeof v === 'object' ? JSON.stringify(v) : v);
        item.appendChild(key);
        item.appendChild(val);
        grid.appendChild(item);
      });
      dtd.appendChild(grid);
      detail.appendChild(dtd);
      tbody.appendChild(detail);

      tr.addEventListener('click', function () {
        detail.style.display = detail.style.display === 'none' ? 'table-row' : 'none';
      });
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    panel.appendChild(wrap);

    var hint = document.createElement('p');
    hint.style.cssText = 'color:var(--text-muted);font-size:12px;margin:10px 0 0;';
    hint.textContent = 'Click a row to see all details.';
    panel.appendChild(hint);
  }

  function load(status) {
    panel.style.display = 'block';
    panel.innerHTML = '<p>Loading ' + status + ' tickets...</p>';
    fetch('/api/tickets?status=' + encodeURIComponent(status))
      .then(function (r) {
        if (!r.ok) { throw new Error('request failed'); }
        return r.json();
      })
      .then(function (data) { render(status, data); })
      .catch(function () {
        panel.innerHTML = '<p>Could not load tickets. Please try again.</p>';
      });
  }

  pipeline.addEventListener('click', function (e) {
    var box = e.target.closest('#pipeline > div');
    if (!box) return;
    var status = STATUSES.find(function (s) { return box.textContent.indexOf(s) !== -1; });
    if (!status) return;

    Array.prototype.forEach.call(pipeline.children, function (c) { c.classList.remove('active'); });
    box.classList.add('active');
    load(status);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
})();