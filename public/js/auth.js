(function () {
  'use strict';

  var DM = window.DM;
  var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var INVALID_EMAIL = 'Please enter a valid email address.';

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var loginForm = document.getElementById('login-form');
  var registerForm = document.getElementById('register-form');
  var adminLoginForm = document.getElementById('admin-login-form');
  var adminCreateForm = document.getElementById('admin-create-form');
  var loginMessage = document.getElementById('login-message');
  var registerMessage = document.getElementById('register-message');
  var adminMessage = document.getElementById('admin-message');
  var adminCreateMessage = document.getElementById('admin-create-message');
  var otpMessage = document.getElementById('otp-message');

  var regToken = null;
  var otpVerified = false;
  var sendCountdown = null;

  function setMessage(el, type, text) {
    el.className = 'form-message ' + type;
    el.textContent = text || '';
  }
  function clearMessage(el) {
    el.className = 'form-message';
    el.textContent = '';
  }
  function setFieldError(input, errorEl, message) {
    if (!errorEl) return;
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
  function normalizePhone(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function showAdminPane(which) {
    if (which === 'create') {
      adminLoginForm.classList.remove('active');
      adminCreateForm.classList.add('active');
    } else {
      adminCreateForm.classList.remove('active');
      adminLoginForm.classList.add('active');
    }
  }

  function switchTab(tabName) {
    tabs.forEach(function (tab) {
      var active = tab.getAttribute('data-tab') === tabName;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    loginForm.classList.toggle('active', tabName === 'login');
    registerForm.classList.toggle('active', tabName === 'register');
    adminLoginForm.classList.toggle('active', tabName === 'admin');
    adminCreateForm.classList.remove('active');
    clearMessage(loginMessage);
    clearMessage(registerMessage);
    clearMessage(adminMessage);
    clearMessage(adminCreateMessage);
  }

  function homeFor(role) {
    if (role === 'farmer') return '#/farmer/overview';
    if (role === 'buyer') return '#/buyer/market';
    return '#/admin/overview';
  }

  function startSendCooldown(button, seconds) {
    if (sendCountdown) clearInterval(sendCountdown);
    var remaining = seconds || 60;
    button.disabled = true;
    button.textContent = 'Resend OTP (' + remaining + 's)';
    sendCountdown = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(sendCountdown);
        sendCountdown = null;
        button.disabled = false;
        button.textContent = 'Resend OTP';
      } else {
        button.textContent = 'Resend OTP (' + remaining + 's)';
      }
    }, 1000);
  }

  function handleError(messageEl, err) {
    setMessage(messageEl, 'error', (err && err.message) || 'Something went wrong.');
  }

  function init() {
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchTab(tab.getAttribute('data-tab'));
      });
    });

    ['login-email', 'reg-email', 'admin-email', 'admin-new-email'].forEach(function (id) {
      var input = document.getElementById(id);
      input.addEventListener('input', function () {
        var errorEl = document.getElementById(id + '-error');
        if (input.value.trim() && !isValidEmail(input.value)) {
          setFieldError(input, errorEl, INVALID_EMAIL);
        } else {
          setFieldError(input, errorEl, '');
        }
      });
    });

    ['reg-password', 'reg-confirm-password', 'admin-new-password', 'admin-new-confirm'].forEach(function (id) {
      var input = document.getElementById(id);
      var matchId = id.indexOf('confirm') !== -1 ? (id.indexOf('admin') !== -1 ? 'admin-new-password' : 'reg-password') : null;
      input.addEventListener('input', function () {
        var errorEl = document.getElementById(id + '-error');
        if (input.value && input.value.length < 6) {
          setFieldError(input, errorEl, 'Password must be at least 6 characters long.');
        } else if (matchId && input.value && input.value !== document.getElementById(matchId).value) {
          setFieldError(input, errorEl, 'Passwords do not match.');
        } else {
          setFieldError(input, errorEl, '');
        }
      });
    });

    // ---------- Buyer / Farmer login ----------
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
      setMessage(loginMessage, '', 'Logging in...');

      DM.api('POST', '/api/auth/login', { email: email, password: passwordInput.value })
        .then(function (data) {
          DM.storeSession(data.token, data.user);
          DM.toast('Welcome back, ' + data.user.name + '!', 'success');
          DM.App.showApp(data.user);
          var home = homeFor(data.user.role);
          if ((location.hash || '').replace(/^#/, '') === home.replace(/^#/, '')) {
            DM.App.renderRoute();
          } else {
            window.location.hash = home;
          }
        })
        .catch(function (err) {
          setMessage(loginMessage, 'error', err.message || 'Invalid email or password.');
        })
        .finally(function () {
          submit.disabled = false;
        });
    });

    // ---------- Admin login ----------
    adminLoginForm.addEventListener('submit', function (event) {
      event.preventDefault();
      clearMessage(adminMessage);

      var emailInput = document.getElementById('admin-email');
      var passwordInput = document.getElementById('admin-password');
      var emailError = document.getElementById('admin-email-error');
      var passwordError = document.getElementById('admin-password-error');
      var email = emailInput.value.trim();
      var valid = true;

      if (!isValidEmail(email)) {
        setFieldError(emailInput, emailError, email ? INVALID_EMAIL : 'Please enter your email address.');
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

      var submit = document.getElementById('admin-login-submit');
      submit.disabled = true;
      setMessage(adminMessage, '', 'Logging in...');

      DM.api('POST', '/api/auth/login', { email: email, password: passwordInput.value })
        .then(function (data) {
          if (data.user.role !== 'admin') {
            setMessage(adminMessage, 'error', 'This account is not an admin. Use the Buyer / Farmer login instead.');
            return;
          }
          DM.storeSession(data.token, data.user);
          DM.toast('Welcome back, ' + data.user.name + '!', 'success');
          DM.App.showApp(data.user);
          var home = '#/admin/overview';
          if ((location.hash || '').replace(/^#/, '') === home.replace(/^#/, '')) {
            DM.App.renderRoute();
          } else {
            window.location.hash = home;
          }
        })
        .catch(function (err) {
          setMessage(adminMessage, 'error', err.message || 'Invalid admin credentials.');
        })
        .finally(function () {
          submit.disabled = false;
        });
    });

    // ---------- Create New Admin ----------
    document.getElementById('admin-create-toggle').addEventListener('click', function () {
      clearMessage(adminMessage);
      clearMessage(adminCreateMessage);
      showAdminPane('create');
    });
    document.getElementById('admin-back-login').addEventListener('click', function () {
      clearMessage(adminMessage);
      clearMessage(adminCreateMessage);
      showAdminPane('login');
    });

    adminCreateForm.addEventListener('submit', function (event) {
      event.preventDefault();
      clearMessage(adminCreateMessage);

      var fields = {
        name: document.getElementById('admin-new-name'),
        email: document.getElementById('admin-new-email'),
        password: document.getElementById('admin-new-password'),
        confirm: document.getElementById('admin-new-confirm'),
        setupCode: document.getElementById('admin-setup-code'),
      };
      var errors = {
        name: document.getElementById('admin-new-name-error'),
        email: document.getElementById('admin-new-email-error'),
        password: document.getElementById('admin-new-password-error'),
        confirm: document.getElementById('admin-new-confirm-error'),
        setupCode: document.getElementById('admin-setup-code-error'),
      };
      var valid = true;

      if (!fields.name.value.trim()) {
        setFieldError(fields.name, errors.name, 'Please enter your name.');
        valid = false;
      } else {
        setFieldError(fields.name, errors.name, '');
      }
      if (!isValidEmail(fields.email.value)) {
        setFieldError(fields.email, errors.email, fields.email.value.trim() ? INVALID_EMAIL : 'Please enter an email address.');
        valid = false;
      } else {
        setFieldError(fields.email, errors.email, '');
      }
      if (!fields.password.value || fields.password.value.length < 6) {
        setFieldError(fields.password, errors.password, 'Password must be at least 6 characters long.');
        valid = false;
      } else {
        setFieldError(fields.password, errors.password, '');
      }
      if (fields.confirm.value !== fields.password.value) {
        setFieldError(fields.confirm, errors.confirm, 'Passwords do not match.');
        valid = false;
      } else {
        setFieldError(fields.confirm, errors.confirm, '');
      }
      if (!fields.setupCode.value.trim()) {
        setFieldError(fields.setupCode, errors.setupCode, 'Please enter the Admin Setup Code.');
        valid = false;
      } else {
        setFieldError(fields.setupCode, errors.setupCode, '');
      }
      if (!valid) return;

      var submit = document.getElementById('admin-create-submit');
      submit.disabled = true;
      setMessage(adminCreateMessage, '', 'Creating admin account...');

      DM.api('POST', '/api/auth/admin/setup', {
        name: fields.name.value.trim(),
        email: fields.email.value.trim(),
        password: fields.password.value,
        setupCode: fields.setupCode.value.trim(),
      })
        .then(function (data) {
          setMessage(adminCreateMessage, 'success', data.message || 'Admin account created. You can now log in.');
          var createdEmail = fields.email.value.trim();
          setTimeout(function () {
            showAdminPane('login');
            document.getElementById('admin-email').value = createdEmail;
            document.getElementById('admin-password').value = '';
            clearMessage(adminMessage);
            setMessage(adminMessage, 'success', 'Admin account created. Log in with your new credentials.');
            adminCreateForm.reset();
          }, 1200);
        })
        .catch(function (err) {
          setMessage(adminCreateMessage, 'error', err.message || 'Could not create admin account.');
        })
        .finally(function () {
          submit.disabled = false;
        });
    });

    // ---------- OTP for registration ----------
    var sendBtn = document.getElementById('send-otp');
    var verifyBtn = document.getElementById('verify-otp');
    var phoneInput = document.getElementById('reg-phone');

    sendBtn.addEventListener('click', function () {
      var phone = phoneInput.value.trim();
      var phoneError = document.getElementById('reg-phone-error');
      clearMessage(otpMessage);
      if (!normalizePhone(phone)) {
        setFieldError(phoneInput, phoneError, 'Please enter a valid mobile number.');
        return;
      }
      setFieldError(phoneInput, phoneError, '');
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending...';
      DM.api('POST', '/api/auth/send-otp', { phone: phone })
        .then(function (data) {
          var field = document.getElementById('otp-field');
          field.classList.remove('hidden');
          document.getElementById('reg-otp').focus();
          setMessage(otpMessage, 'success', data.message || 'OTP sent. Check your mobile phone.');
          startSendCooldown(sendBtn, data.resendAfterSeconds || 60);
        })
        .catch(function (err) {
          setMessage(otpMessage, 'error', err.message || 'Could not send OTP.');
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send OTP';
        });
    });

    verifyBtn.addEventListener('click', function () {
      var phone = phoneInput.value.trim();
      var code = document.getElementById('reg-otp').value.trim();
      var otpError = document.getElementById('reg-otp-error');
      if (!normalizePhone(phone)) {
        setFieldError(phoneInput, document.getElementById('reg-phone-error'), 'Please enter a valid mobile number.');
        return;
      }
      if (!/^[0-9]{6}$/.test(code)) {
        setFieldError(document.getElementById('reg-otp'), otpError, 'Enter the 6-digit code from your phone.');
        return;
      }
      setFieldError(document.getElementById('reg-otp'), otpError, '');
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Verifying...';
      DM.api('POST', '/api/auth/verify-otp', { phone: phone, code: code })
        .then(function (data) {
          regToken = data.regToken;
          otpVerified = true;
          setMessage(otpMessage, 'success', data.message || 'Phone number verified.');
          verifyBtn.textContent = 'Verified';
          verifyBtn.disabled = true;
          sendBtn.disabled = true;
          document.getElementById('register-submit').disabled = false;
        })
        .catch(function (err) {
          setMessage(otpMessage, 'error', err.message || 'Could not verify OTP.');
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify OTP';
        });
    });

    registerForm.addEventListener('submit', function (event) {
      event.preventDefault();
      clearMessage(registerMessage);

      var nameInput = document.getElementById('reg-name');
      var emailInput = document.getElementById('reg-email');
      var passwordInput = document.getElementById('reg-password');
      var confirmInput = document.getElementById('reg-confirm-password');
      var phoneInputAlt = document.getElementById('reg-phone');
      var roleInput = registerForm.querySelector('input[name="role"]:checked');

      var errorEls = {
        name: document.getElementById('reg-name-error'),
        email: document.getElementById('reg-email-error'),
        password: document.getElementById('reg-password-error'),
        confirm: document.getElementById('reg-confirm-error'),
        phone: document.getElementById('reg-phone-error'),
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
      if (!normalizePhone(phoneInputAlt.value)) {
        setFieldError(phoneInputAlt, errorEls.phone, 'Please enter a valid mobile number.');
        valid = false;
      } else {
        setFieldError(phoneInputAlt, errorEls.phone, '');
      }
      if (!roleInput || !['farmer', 'buyer'].includes(roleInput.value)) {
        errorEls.role.textContent = 'Please select a role (Farmer or Buyer).';
        valid = false;
      } else {
        errorEls.role.textContent = '';
      }
      if (!otpVerified || !regToken) {
        setMessage(registerMessage, 'error', 'Please verify your phone number with the OTP first.');
        valid = false;
      }
      if (!valid) return;

      var submit = document.getElementById('register-submit');
      submit.disabled = true;
      setMessage(registerMessage, '', 'Creating account...');

      DM.api('POST', '/api/auth/register', {
        name: name,
        email: email,
        password: passwordInput.value,
        role: roleInput.value,
        phone: phoneInputAlt.value.trim(),
        regToken: regToken,
        location: document.getElementById('reg-location').value.trim(),
      })
        .then(function (data) {
          setMessage(registerMessage, 'success', 'Account created for ' + data.user.email + ' as ' + data.user.role + '. You can now log in.');
          setTimeout(function () {
            switchTab('login');
            setMessage(loginMessage, 'success', 'Account created for ' + data.user.email + '. You can now log in.');
            registerForm.reset();
            otpVerified = false;
            regToken = null;
            document.getElementById('otp-field').classList.add('hidden');
            clearMessage(otpMessage);
            document.getElementById('register-submit').disabled = true;
            if (sendCountdown) clearInterval(sendCountdown);
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send OTP';
          }, 1200);
        })
        .catch(function (err) {
          setMessage(registerMessage, 'error', err.message || 'Registration failed.');
        })
        .finally(function () {
          submit.disabled = false;
        });
    });
  }

  DM.Auth = { init: init, switchTab: switchTab };
})();