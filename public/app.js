(function () {
  'use strict';

  var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var INVALID_EMAIL = 'Please enter a valid email address.';
  var ALLOWED_ROLES = { farmer: true, buyer: true };

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var loginForm = document.getElementById('login-form');
  var registerForm = document.getElementById('register-form');
  var loginMessage = document.getElementById('login-message');
  var registerMessage = document.getElementById('register-message');

  function setMessage(el, type, text) {
    el.className = 'form-message ' + type;
    el.textContent = text || '';
  }

  function clearMessage(el) {
    el.className = 'form-message';
    el.textContent = '';
  }

  function setFieldError(input, errorEl, message) {
    if (message) {
      input.classList.add('invalid');
      errorEl.textContent = message;
    } else {
      input.classList.remove('invalid');
      errorEl.textContent = '';
    }
  }

  function isValidEmail(value) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 254 && EMAIL_REGEX.test(value.trim());
  }

  function switchTab(tabName) {
    tabs.forEach(function (tab) {
      var active = tab.getAttribute('data-tab') === tabName;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    loginForm.classList.toggle('active', tabName === 'login');
    registerForm.classList.toggle('active', tabName === 'register');
    clearMessage(loginMessage);
    clearMessage(registerMessage);
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      switchTab(tab.getAttribute('data-tab'));
    });
  });

  ['login-email', 'reg-email'].forEach(function (id) {
    var input = document.getElementById(id);
    var errorEl = document.getElementById(id === 'login-email' ? 'login-email-error' : 'reg-email-error');
    input.addEventListener('input', function () {
      if (input.value.trim() && !isValidEmail(input.value)) {
        setFieldError(input, errorEl, INVALID_EMAIL);
      } else {
        setFieldError(input, errorEl, '');
      }
    });
  });

  ['reg-password', 'reg-confirm-password'].forEach(function (id) {
    var input = document.getElementById(id);
    var errorEl = document.getElementById(id === 'reg-password' ? 'reg-password-error' : 'reg-confirm-error');
    input.addEventListener('input', function () {
      if (input.value && input.value.length < 6) {
        setFieldError(input, errorEl, 'Password must be at least 6 characters long.');
      } else if (
        id === 'reg-confirm-password' &&
        input.value &&
        input.value !== document.getElementById('reg-password').value
      ) {
        setFieldError(input, errorEl, 'Passwords do not match.');
      } else {
        setFieldError(input, errorEl, '');
      }
    });
  });

  loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    clearMessage(loginMessage);

    var emailInput = document.getElementById('login-email');
    var passwordInput = document.getElementById('login-password');
    var emailError = document.getElementById('login-email-error');
    var passwordError = document.getElementById('login-password-error');

    var email = emailInput.value.trim();
    var valid = true;

    if (!email) {
      setFieldError(emailInput, emailError, 'Please enter your email address.');
      valid = false;
    } else if (!isValidEmail(email)) {
      setFieldError(emailInput, emailError, INVALID_EMAIL);
      valid = false;
    } else {
      setFieldError(emailInput, emailError, '');
    }

    if (!passwordInput.value) {
      setFieldError(passwordInput, passwordError, 'Please enter your password.');
      valid = false;
    } else {
      setFieldError(passwordInput, passwordError, '');
    }

    if (!valid) return;

    var submit = document.getElementById('login-submit');
    submit.disabled = true;
    setMessage(loginMessage, '', 'Logging in&hellip;');

    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: passwordInput.value }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok) {
          var user = result.data.user || {};
          setMessage(
            loginMessage,
            'success',
            'Welcome back, ' + user.name + '! You are logged in as ' + user.role + '.'
          );
          loginForm.querySelector('button[type="submit"]').textContent = 'Logged In';
        } else {
          setMessage(loginMessage, 'error', result.data.error || 'Invalid email or password.');
        }
      })
      .catch(function () {
        setMessage(loginMessage, 'error', 'Something went wrong. Please try again.');
      })
      .finally(function () {
        submit.disabled = false;
      });
  });

  registerForm.addEventListener('submit', function (event) {
    event.preventDefault();
    clearMessage(registerMessage);

    var nameInput = document.getElementById('reg-name');
    var emailInput = document.getElementById('reg-email');
    var passwordInput = document.getElementById('reg-password');
    var confirmInput = document.getElementById('reg-confirm-password');
    var roleInput = registerForm.querySelector('input[name="role"]:checked');

    var errorEls = {
      name: document.getElementById('reg-name-error'),
      email: document.getElementById('reg-email-error'),
      password: document.getElementById('reg-password-error'),
      confirm: document.getElementById('reg-confirm-error'),
      role: document.getElementById('reg-role-error'),
    };

    var name = nameInput.value.trim();
    var email = emailInput.value.trim();
    var valid = true;

    if (!name) {
      setFieldError(nameInput, errorEls.name, 'Please enter your name.');
      valid = false;
    } else {
      setFieldError(nameInput, errorEls.name, '');
    }

    if (!email) {
      setFieldError(emailInput, errorEls.email, 'Please enter your email address.');
      valid = false;
    } else if (!isValidEmail(email)) {
      setFieldError(emailInput, errorEls.email, INVALID_EMAIL);
      valid = false;
    } else {
      setFieldError(emailInput, errorEls.email, '');
    }

    if (!passwordInput.value) {
      setFieldError(passwordInput, errorEls.password, 'Please enter a password.');
      valid = false;
    } else if (passwordInput.value.length < 6) {
      setFieldError(passwordInput, errorEls.password, 'Password must be at least 6 characters long.');
      valid = false;
    } else {
      setFieldError(passwordInput, errorEls.password, '');
    }

    if (confirmInput.value !== passwordInput.value) {
      setFieldError(confirmInput, errorEls.confirm, 'Passwords do not match.');
      valid = false;
    } else {
      setFieldError(confirmInput, errorEls.confirm, '');
    }

    if (!roleInput || !ALLOWED_ROLES[roleInput.value]) {
      errorEls.role.textContent = 'Please select a role (Farmer or Buyer).';
      valid = false;
    } else {
      errorEls.role.textContent = '';
    }

    if (!valid) return;

    var submit = document.getElementById('register-submit');
    submit.disabled = true;
    setMessage(registerMessage, '', 'Creating account&hellip;');

    fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        email: email,
        password: passwordInput.value,
        role: roleInput.value,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok) {
          var user = result.data.user || {};
          setMessage(
            registerMessage,
            'success',
            'Account created for ' + user.email + ' as ' + user.role + '. You can now log in.'
          );
          registerForm.querySelector('button[type="submit"]').textContent = 'Account Created';
          setTimeout(function () {
            switchTab('login');
          }, 1200);
        } else {
          setMessage(registerMessage, 'error', result.data.error || 'Registration failed.');
        }
      })
      .catch(function () {
        setMessage(registerMessage, 'error', 'Something went wrong. Please try again.');
      })
      .finally(function () {
        submit.disabled = false;
      });
  });
})();
