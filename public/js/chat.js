(function () {
  'use strict';

  var DM = window.DM;
  var drawer, overlay, partnersEl, convoEl, messagesEl, badge, withEl, formEl, inputEl;
  var activePartnerId = null;
  var timers = [];
  var initialized = false;

  function show(view) {
    if (!drawer) return;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    overlay.classList.remove('hidden');
    if (view === 'partners') {
      partnersEl.classList.remove('hidden');
      convoEl.classList.add('hidden');
    } else {
      partnersEl.classList.add('hidden');
      convoEl.classList.remove('hidden');
    }
  }

  function hide() {
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    overlay.classList.add('hidden');
  }

  function renderPartners(partners) {
    partnersEl.innerHTML = '';
    if (!partners || partners.length === 0) {
      partnersEl.appendChild(DM.emptyState('No conversations yet', 'Start chatting with a farmer or buyer from product pages.'));
      return;
    }
    partners.forEach(function (p) {
      var row = DM.el('div', {
        class: 'partner ' + (p.id === activePartnerId ? 'active' : ''),
        dataset: { id: p.id },
      }, [
        DM.avatar(p.name),
        DM.el('div', { class: 'partner-meta' }, [
          DM.el('div', { class: 'partner-name' }, [
            DM.el('span', { text: p.name }),
            p.unread > 0 ? DM.el('span', { class: 'chat-badge', text: p.unread }) : null,
          ]),
          DM.el('div', { class: 'partner-last', text: p.lastMessage ? (p.lastMessage.fromMe ? 'You: ' : '') + p.lastMessage.body : (p.role + ' - ' + (p.location || 'no location')) }),
        ]),
      ]);
      row.addEventListener('click', function () {
        openConversation(p.id);
      });
      partnersEl.appendChild(row);
    });
  }

  async function refreshPartners() {
    try {
      var data = await DM.api('GET', '/api/chat/partners');
      if (!drawer.classList.contains('open') || activePartnerId === null) {
        renderPartners(data.partners);
      } else {
        var current = data.partners.filter(function (p) {
          return p.id === activePartnerId;
        })[0];
        if (current && current.unread > 0) {
          renderPartners(data.partners);
        }
      }
    } catch (e) {}
  }

  async function refreshUnread() {
    try {
      var data = await DM.api('GET', '/api/chat/unread');
      var n = data.unread || 0;
      badge.textContent = n;
      badge.classList.toggle('hidden', n === 0);
    } catch (e) {}
  }

  async function openConversation(userId) {
    activePartnerId = userId;
    show('conversation');
    withEl.innerHTML = '';
    try {
      var data = await DM.api('GET', '/api/chat/' + userId);
      withEl.textContent = data.partner.name + ' (' + data.partner.role + ')';
      messagesEl.innerHTML = '';
      if (data.messages.length === 0) {
        messagesEl.appendChild(DM.emptyState('No messages yet', 'Say hello to start the conversation.'));
      }
      data.messages.forEach(function (m) {
        appendMessage(m);
      });
      messagesEl.scrollTop = messagesEl.scrollHeight;
      refreshPartners();
      refreshUnread();
    } catch (e) {
      DM.toast(e.message, 'error');
      show('partners');
    }
  }

  function appendMessage(m) {
    var me = DM.getStoredUser();
    var mine = m.sender_id === me.id;
    var bubble = DM.el('div', { class: 'msg-row ' + (mine ? 'mine' : 'theirs') }, [
      DM.el('div', { class: 'msg-bubble' }, [
        DM.el('div', { text: m.body }),
        DM.el('div', { class: 'msg-time', text: DM.formatDate(m.created_at) + ' ' + new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }),
      ]),
    ]);
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function pollActiveConversation() {
    if (activePartnerId !== null && drawer.classList.contains('open')) {
      try {
        var data = await DM.api('GET', '/api/chat/' + activePartnerId);
        var count = messagesEl.querySelectorAll('.msg-row').length;
        if (data.messages.length > count) {
          messagesEl.innerHTML = '';
          data.messages.forEach(function (m) {
            appendMessage(m);
          });
        }
      } catch (e) {}
    }
  }

  function startPolling() {
    if (timers.length) return;
    timers.push(setInterval(refreshUnread, 6000));
    timers.push(setInterval(refreshPartners, 8000));
    timers.push(setInterval(pollActiveConversation, 3000));
  }

  function stopPolling() {
    timers.forEach(clearInterval);
    timers = [];
  }

  function reset() {
    activePartnerId = null;
    stopPolling();
    hide();
  }

  function open() {
    show(activePartnerId !== null ? 'conversation' : 'partners');
    refreshPartners();
    refreshUnread();
    if (activePartnerId !== null) pollActiveConversation();
  }

  function init() {
    if (initialized) {
      startPolling();
      refreshUnread();
      return;
    }
    initialized = true;
    drawer = document.getElementById('chat-drawer');
    overlay = document.getElementById('chat-overlay');
    partnersEl = document.getElementById('chat-partners');
    convoEl = document.getElementById('chat-conversation');
    messagesEl = document.getElementById('chat-messages');
    badge = document.getElementById('chat-badge');
    withEl = document.getElementById('chat-with');
    formEl = document.getElementById('chat-form');
    inputEl = document.getElementById('chat-input');

    document.getElementById('chat-toggle').addEventListener('click', open);
    document.getElementById('chat-close').addEventListener('click', function () {
      hide();
    });
    overlay.addEventListener('click', hide);

    formEl.addEventListener('submit', async function (e) {
      e.preventDefault();
      var body = inputEl.value.trim();
      if (!body || activePartnerId === null) return;
      inputEl.value = '';
      try {
        await DM.api('POST', '/api/chat/' + activePartnerId, { body: body });
        await pollActiveConversation();
      } catch (err) {
        DM.toast(err.message, 'error');
      }
    });

    startPolling();
    refreshUnread();
  }

  DM.Chat = { init: init, open: open, openConversation: openConversation, stopPolling: stopPolling, reset: reset, hide: hide };
})();
