(function () {
  'use strict';

  window.DM = window.DM || {};

  var TOKEN_KEY = 'dm_token';
  var USER_KEY = 'dm_user';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }
  function getStoredUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY)) || null;
    } catch (e) {
      return null;
    }
  }
  function storeSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function api(method, url, body) {
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    var opts = { method: method, headers: headers };
    if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
    var res = await fetch(url, opts);
    var data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = {};
    }
    if (!res.ok) {
      var err = new Error((data && data.error) || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(n) {
    var num = Number(n) || 0;
    return 'UGX ' + num.toLocaleString('en-US');
  }

  function formatDate(s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function freshness(harvestDate) {
    if (!harvestDate) return { label: 'Freshness unknown', cls: 'neutral', days: null };
    var d = new Date(harvestDate);
    if (isNaN(d.getTime())) return { label: 'Freshness unknown', cls: 'neutral', days: null };
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days < 0) days = 0;
    var label;
    var cls;
    if (days <= 1) {
      label = 'Very fresh';
      cls = 'good';
    } else if (days <= 4) {
      label = 'Fresh';
      cls = 'good';
    } else if (days <= 10) {
      label = 'Still good';
      cls = 'warn';
    } else {
      label = 'Old stock';
      cls = 'bad';
    }
    return { label: label + ' (' + days + 'd)', cls: cls, days: days };
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'dataset') {
          Object.keys(attrs[k]).forEach(function (dk) {
            node.dataset[dk] = attrs[k][dk];
          });
        } else if (k.indexOf('on') === 0) {
          node.addEventListener(k.slice(2), attrs[k]);
        } else {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    if (children !== undefined && children !== null) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function toast(message, type) {
    var root = document.getElementById('toast-root');
    var node = el('div', { class: 'toast ' + (type || 'info'), text: message });
    root.appendChild(node);
    setTimeout(function () {
      node.classList.add('show');
    }, 10);
    setTimeout(function () {
      node.classList.remove('show');
      setTimeout(function () {
        node.remove();
      }, 300);
    }, 3200);
  }

  var modalStack = [];
  function openModal(content, opts) {
    opts = opts || {};
    var root = document.getElementById('modal-root');
    var modal = el('div', { class: 'modal-backdrop' });
    var dialog = el('div', { class: 'modal ' + (opts.size || '') });
    if (opts.title) {
      dialog.appendChild(el('div', { class: 'modal-head', html: '<h3>' + esc(opts.title) + '</h3>' }));
    }
    var body = el('div', { class: 'modal-body' });
    if (typeof content === 'string') body.innerHTML = content;
    else body.appendChild(content);
    dialog.appendChild(body);
    if (opts.footer) {
      var foot = el('div', { class: 'modal-foot' });
      if (typeof opts.footer === 'string') foot.innerHTML = opts.footer;
      else foot.appendChild(opts.footer);
      dialog.appendChild(foot);
    }
    var closeBtn = el('button', { class: 'modal-close', html: '&times;', 'aria-label': 'Close' });
    dialog.appendChild(closeBtn);
    modal.appendChild(dialog);
    root.appendChild(modal);

    function close() {
      modal.classList.add('closing');
      setTimeout(function () {
        modal.remove();
      }, 150);
    }
    closeBtn.addEventListener('click', close);
    modal.addEventListener('click', function (e) {
      if (e.target === modal && !opts.static) close();
    });
    modalStack.push(close);
    return { close: close, body: body, dialog: dialog };
  }
  function closeModal() {
    var fn = modalStack.pop();
    if (fn) fn();
  }

  function placeholderImage(categoryName) {
    var name = (categoryName || 'produce').toLowerCase();
    var colors = {
      vegetables: ['#16a34a', '#dcfce7'],
      fruits: ['#ea580c', '#ffedd5'],
      grains: ['#d97706', '#fef3c7'],
      dairy: ['#2563eb', '#dbeafe'],
      meat: ['#b91c1c', '#fee2e2'],
      tubers: ['#a16207', '#fef9c3'],
    };
    var palette = colors[name] || ['#16a34a', '#dcfce7'];
    var label = (categoryName || 'produce').split(' ')[0];
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
      '<rect width="200" height="200" fill="' + palette[1] + '"/>' +
      '<circle cx="100" cy="86" r="46" fill="' + palette[0] + '" opacity="0.85"/>' +
      '<rect x="94" y="126" width="12" height="34" rx="6" fill="' + palette[0] + '" opacity="0.85"/>' +
      '<text x="100" y="96" font-family="Arial" font-size="15" font-weight="700" fill="' + palette[1] + '" text-anchor="middle">' + esc(label.toUpperCase()) + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function avatar(name) {
    var initials = String(name || '?')
      .split(/\s+/)
      .map(function (w) {
        return w.charAt(0);
      })
      .slice(0, 2)
      .join('')
      .toUpperCase();
    return el('span', { class: 'avatar', text: initials });
  }

  function statusBadge(label, type) {
    return el('span', { class: 'badge badge-' + (type || 'neutral'), text: label });
  }

  function setView(html) {
    var view = document.getElementById('view');
    view.innerHTML = html;
    view.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function skeleton() {
    return '<div class="loading">Loading&hellip;</div>';
  }

  function emptyState(title, hint) {
    return el('div', { class: 'empty-state' }, [
      el('h3', { text: title }),
      el('p', { text: hint || '' }),
    ]);
  }

  function field(labelText, input) {
    return el('div', { class: 'field' }, [el('label', { text: labelText }), input]);
  }

  function confirmDialog(title, message, onYes) {
    var yesBtn = el('button', { class: 'btn-danger', text: 'Confirm' });
    var noBtn = el('button', { class: 'btn-ghost', text: 'Cancel' });
    var foot = el('div', { class: 'btn-row' }, [noBtn, yesBtn]);
    var m = openModal(el('div', {}, [el('p', { text: message })]), { title: title, footer: foot });
    yesBtn.addEventListener('click', function () {
      m.close();
      onYes();
    });
    noBtn.addEventListener('click', m.close);
  }

  window.DM = {
    getToken: getToken,
    getStoredUser: getStoredUser,
    storeSession: storeSession,
    clearSession: clearSession,
    api: api,
    esc: esc,
    money: money,
    formatDate: formatDate,
    freshness: freshness,
    el: el,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    placeholderImage: placeholderImage,
    avatar: avatar,
    statusBadge: statusBadge,
    setView: setView,
    skeleton: skeleton,
    emptyState: emptyState,
    field: field,
    confirmDialog: confirmDialog,
  };
})();
