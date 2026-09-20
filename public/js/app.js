(function () {
  'use strict';

  var DM = window.DM;

  var authView = document.getElementById('auth-view');
  var appView = document.getElementById('app-view');
  var viewEl = document.getElementById('view');
  var navLinks = document.getElementById('nav-links');
  var navToggle = document.getElementById('nav-toggle');
  var navOverlay = document.getElementById('nav-overlay');

  var currentUser = null;

  var NAV = {
    farmer: [
      { href: '#/farmer/overview', label: 'Dashboard', route: '/overview' },
      { href: '#/farmer/products', label: 'My Products', route: '/products' },
      { href: '#/farmer/products/add', label: 'Add Product', route: '/products/add' },
      { href: '#/farmer/orders', label: 'Orders', route: '/orders' },
      { href: '#/farmer/sales', label: 'Sales History', route: '/sales' },
    ],
    buyer: [
      { href: '#/buyer/market', label: 'Marketplace', route: '/market' },
      { href: '#/buyer/farmers', label: 'Find Farmers', route: '/farmers' },
      { href: '#/buyer/wishlist', label: 'My Wishlist', route: '/wishlist' },
      { href: '#/buyer/cart', label: 'Cart', route: '/cart', cart: true },
      { href: '#/buyer/orders', label: 'My Orders', route: '/orders' },
      { href: '#/buyer/reviews', label: 'My Reviews', route: '/reviews' },
    ],
    admin: [
      { href: '#/admin/overview', label: 'Dashboard', route: '/overview' },
      { href: '#/admin/users', label: 'Users', route: '/users' },
      { href: '#/admin/products', label: 'Products', route: '/products' },
      { href: '#/admin/orders', label: 'Orders', route: '/orders' },
      { href: '#/admin/reports', label: 'Reports', route: '/reports' },
    ],
  };

  var SHARED_NAV = [
    { href: '#/profile', label: 'Profile' },
    { href: '#/settings', label: 'Settings' },
  ];

  function homeFor(role) {
    if (role === 'farmer') return '#/farmer/overview';
    if (role === 'buyer') return '#/buyer/market';
    return '#/admin/overview';
  }

  function closeNav() {
    navLinks.classList.remove('open');
    navOverlay.classList.add('hidden');
  }

  function buildNav() {
    navLinks.innerHTML = '';
    (NAV[currentUser.role] || []).forEach(function (item) {
      var li = DM.el('li', { class: 'nav-item' });
      var a = DM.el('a', { class: 'nav-link', href: item.href, text: item.label });
      if (item.cart) {
        a.appendChild(DM.el('span', { class: 'cart-badge hidden', id: 'nav-cart-badge', text: '0' }));
      }
      a.addEventListener('click', closeNav);
      li.appendChild(a);
      navLinks.appendChild(li);
    });
    SHARED_NAV.forEach(function (item) {
      var li = DM.el('li', { class: 'nav-item' });
      var a = DM.el('a', { class: 'nav-link', href: item.href, text: item.label });
      a.addEventListener('click', closeNav);
      li.appendChild(a);
      navLinks.appendChild(li);
    });
  }

  function setActiveNav() {
    var hash = (location.hash || '').replace(/^#/, '') || homeFor(currentUser.role);
    navLinks.querySelectorAll('.nav-link').forEach(function (a) {
      var href = a.getAttribute('href').replace(/^#/, '');
      var active = hash === href;
      a.classList.toggle('active', active);
    });
  }

  function showApp(user) {
    currentUser = user;
    authView.classList.add('hidden');
    appView.classList.remove('hidden');
    document.getElementById('nav-role').textContent = user.role;
    document.getElementById('nav-name').textContent = user.name;
    document.getElementById('nav-role').className = 'role-badge role-' + user.role;
    buildNav();
    if (user.role === 'buyer') {
      DM.Buyer.refreshCartBadge();
    }
    DM.Chat.init();
    setActiveNav();
  }

  function showAuth() {
    currentUser = null;
    appView.classList.add('hidden');
    authView.classList.remove('hidden');
    DM.Chat.reset();
    window.scrollTo(0, 0);
  }

  function matchRoute(pattern, parts) {
    var pParts = pattern.split('/').filter(Boolean);
    if (pParts.length !== parts.length) return null;
    var params = {};
    for (var i = 0; i < pParts.length; i++) {
      if (pParts[i].charAt(0) === ':') {
        params[pParts[i].slice(1)] = parts[i];
      } else if (pParts[i] !== parts[i]) {
        return null;
      }
    }
    return params;
  }

  function renderRoute() {
    if (!currentUser) {
      showAuth();
      return;
    }
    var raw = (location.hash || '').replace(/^#\/?/, '');
    var parts = raw.split('/').filter(Boolean);
    if (parts.length === 0) {
      location.replace(homeFor(currentUser.role));
      return;
    }
    var sharedViews = DM.Views.shared || {};
    if (sharedViews['/' + parts[0]]) {
      setActiveNav();
      Promise.resolve(sharedViews['/' + parts[0]]()).catch(function (e) {
        DM.toast('Something went wrong.', 'error');
      });
      return;
    }
    var roleKey = parts[0];
    if (roleKey !== currentUser.role) {
      location.replace(homeFor(currentUser.role));
      return;
    }
    var sub = parts.slice(1);
    var views = DM.Views[roleKey] || {};
    var matched = null;
    var params = {};
    Object.keys(views).forEach(function (pattern) {
      if (matched) return;
      var m = matchRoute(pattern, sub);
      if (m) {
        matched = views[pattern];
        params = m;
      }
    });
    if (!matched) {
      viewEl.innerHTML = '';
      viewEl.appendChild(DM.emptyState('Page not found', 'The page you are looking for does not exist.'));
      return;
    }
    setActiveNav();
    Promise.resolve(matched(params)).catch(function (e) {
      DM.toast('Something went wrong.', 'error');
    });
  }

  async function restoreSession() {
    var token = DM.getToken();
    var stored = DM.getStoredUser();
    if (!token || !stored) {
      showAuth();
      return;
    }
    try {
      var data = await DM.api('GET', '/api/auth/me');
      showApp(data.user);
      renderRoute();
    } catch (e) {
      DM.clearSession();
      showAuth();
    }
  }

  function logout() {
    DM.api('POST', '/api/auth/logout')
      .catch(function () {})
      .finally(function () {
        DM.clearSession();
        DM.toast('Logged out.', 'success');
        location.hash = '#/login';
        showAuth();
      });
  }

  function init() {
    if (window.DM._booted) return;
    window.DM._booted = true;
    DM.Auth.init();
    document.getElementById('logout-btn').addEventListener('click', logout);
    navToggle.addEventListener('click', function () {
      navLinks.classList.toggle('open');
      navOverlay.classList.toggle('hidden');
    });
    navOverlay.addEventListener('click', closeNav);
    window.addEventListener('hashchange', function () {
      if (currentUser) renderRoute();
      else if ((location.hash || '').indexOf('#/') === 0) showAuth();
    });
    if (!location.hash) {
      history.replaceState(null, '', '#/login');
    }
    restoreSession();
  }

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();

  function renderProfile() {
    viewEl.innerHTML = DM.skeleton();
    DM.api('GET', '/api/auth/me')
      .then(function (data) {
        var user = data.user;
        var nameInput = DM.el('input', { type: 'text', id: 'pf-name', maxlength: '100', required: 'required', value: user.name });
        var phoneInput = DM.el('input', { type: 'tel', id: 'pf-phone', maxlength: '30', value: user.phone || '', placeholder: '+256 7xx xxx xxx' });
        var locationInput = DM.el('input', { type: 'text', id: 'pf-location', maxlength: '120', value: user.location || '', placeholder: 'e.g. Kampala, Uganda' });
        var bioInput = DM.el('textarea', { id: 'pf-bio', rows: '4', maxlength: '2000', text: user.bio || '', placeholder: 'Tell buyers or farmers a little about yourself.' });

        var saveBtn = DM.el('button', { class: 'btn-primary', text: 'Save changes' });
        saveBtn.addEventListener('click', async function () {
          var name = nameInput.value.trim();
          if (!name) {
            DM.toast('Please enter your name.', 'error');
            return;
          }
          saveBtn.disabled = true;
          try {
            var res = await DM.api('PATCH', '/api/auth/profile', {
              name: name,
              phone: phoneInput.value.trim(),
              location: locationInput.value.trim(),
              bio: bioInput.value.trim(),
            });
            DM.storeSession(DM.getToken(), res.user);
            document.getElementById('nav-name').textContent = res.user.name;
            DM.toast('Profile updated.', 'success');
            renderProfile();
          } catch (e) {
            DM.toast(e.message, 'error');
            saveBtn.disabled = false;
          }
        });

        var container = DM.el('div', { class: 'page' }, [
          DM.el('div', { class: 'page-head' }, [
            DM.el('h2', { text: 'My Profile' }),
            DM.el('p', { class: 'page-sub', text: 'View and manage your account information.' }),
          ]),
          DM.el('div', { class: 'section' }, [
            DM.el('div', { class: 'profile-card' }, [
              DM.avatar(user.name),
              DM.el('div', { class: 'profile-info' }, [
                DM.el('h3', { text: user.name }),
                DM.el('span', { class: 'badge badge-neutral', text: user.role }),
              ]),
            ]),
            DM.el('div', { class: 'form-grid' }, [
              DM.field('Name', nameInput),
              DM.field('Phone', phoneInput),
              DM.field('Location', locationInput),
              DM.field('Bio', bioInput),
            ]),
            DM.el('div', { class: 'btn-row' }, [saveBtn]),
          ]),
          DM.el('div', { class: 'section' }, [
            DM.el('div', { class: 'info-grid' }, [
              DM.el('div', { class: 'info-item' }, [DM.el('span', { class: 'info-label', text: 'Email' }), DM.el('span', { text: user.email })]),
              DM.el('div', { class: 'info-item' }, [DM.el('span', { class: 'info-label', text: 'Role' }), DM.el('span', { text: user.role.charAt(0).toUpperCase() + user.role.slice(1) })]),
              DM.el('div', { class: 'info-item' }, [DM.el('span', { class: 'info-label', text: 'Member since' }), DM.el('span', { text: DM.formatDate(user.createdAt) })]),
            ]),
          ]),
        ]);
        viewEl.innerHTML = '';
        viewEl.appendChild(container);
      })
      .catch(function (e) {
        DM.toast(e.message, 'error');
        viewEl.innerHTML = '';
        viewEl.appendChild(DM.emptyState('Could not load profile', e.message));
      });
  }

  function renderSettings() {
    viewEl.innerHTML = DM.skeleton();
    var currentInput = DM.el('input', { type: 'password', id: 'st-current', autocomplete: 'current-password', required: 'required' });
    var newInput = DM.el('input', { type: 'password', id: 'st-new', autocomplete: 'new-password', minlength: '6', required: 'required' });
    var confirmInput = DM.el('input', { type: 'password', id: 'st-confirm', autocomplete: 'new-password', minlength: '6', required: 'required' });
    var currentErr = DM.el('p', { class: 'field-error hidden', id: 'st-current-error' });
    var newErr = DM.el('p', { class: 'field-error hidden', id: 'st-new-error' });
    var confirmErr = DM.el('p', { class: 'field-error hidden', id: 'st-confirm-error' });

    var saveBtn = DM.el('button', { class: 'btn-primary', text: 'Change password' });
    saveBtn.addEventListener('click', async function () {
      currentErr.classList.add('hidden');
      newErr.classList.add('hidden');
      confirmErr.classList.add('hidden');
      var valid = true;
      if (!currentInput.value) {
        currentErr.textContent = 'Please enter your current password.';
        currentErr.classList.remove('hidden');
        valid = false;
      }
      if (!newInput.value || newInput.value.length < 6) {
        newErr.textContent = 'New password must be at least 6 characters.';
        newErr.classList.remove('hidden');
        valid = false;
      }
      if (confirmInput.value !== newInput.value) {
        confirmErr.textContent = 'Passwords do not match.';
        confirmErr.classList.remove('hidden');
        valid = false;
      }
      if (!valid) return;
      saveBtn.disabled = true;
      try {
        var res = await DM.api('PATCH', '/api/auth/password', {
          currentPassword: currentInput.value,
          newPassword: newInput.value,
        });
        DM.toast(res.message, 'success');
        currentInput.value = '';
        newInput.value = '';
        confirmInput.value = '';
        saveBtn.disabled = false;
      } catch (e) {
        DM.toast(e.message, 'error');
        saveBtn.disabled = false;
      }
    });

    var container = DM.el('div', { class: 'page' }, [
      DM.el('div', { class: 'page-head' }, [
        DM.el('h2', { text: 'Settings' }),
        DM.el('p', { class: 'page-sub', text: 'Manage your account security.' }),
      ]),
      DM.el('div', { class: 'section' }, [
        DM.el('div', { class: 'form-grid' }, [
          DM.field('Current password', currentInput),
          currentErr,
          DM.field('New password', newInput),
          newErr,
          DM.field('Confirm new password', confirmInput),
          confirmErr,
        ]),
        DM.el('p', { class: 'field-hint', text: 'Changing your password signs out all other devices (this session stays signed in).' }),
        DM.el('div', { class: 'btn-row' }, [saveBtn]),
      ]),
    ]);
    viewEl.innerHTML = '';
    viewEl.appendChild(container);
  }

  DM.Views = DM.Views || {};
  DM.Views.shared = {
    '/profile': renderProfile,
    '/settings': renderSettings,
  };

  DM.App = { showApp: showApp, showAuth: showAuth, renderRoute: renderRoute };
})();
