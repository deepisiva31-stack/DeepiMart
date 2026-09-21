(function () {
  'use strict';

  var DM = window.DM;

  function pageTitle(title, sub) {
    return DM.el('div', { class: 'page-head' }, [
      DM.el('h2', { text: title }),
      sub ? DM.el('p', { class: 'page-sub', text: sub }) : null,
    ]);
  }

  function statCard(label, value, cls) {
    return DM.el('div', { class: 'stat-card ' + (cls || '') }, [
      DM.el('div', { class: 'stat-value', text: value }),
      DM.el('div', { class: 'stat-label', text: label }),
    ]);
  }

  async function renderOverview() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var reports = await DM.api('GET', '/api/admin/reports');
      var users = await DM.api('GET', '/api/admin/users');
      var products = await DM.api('GET', '/api/admin/products');
      var orders = await DM.api('GET', '/api/admin/orders');

      var byRole = {};
      reports.users.byRole.forEach(function (r) {
        byRole[r.role] = r.n;
      });

      var recentOrders = orders.orders.slice(0, 6);
      var pendingProducts = products.products.filter(function (p) {
        return p.status === 'pending';
      });

      var orderTable = DM.el('table', { class: 'data-table' }, [
        DM.el('thead', null, [DM.el('tr', null, ['Code', 'Buyer', 'Farmer', 'Total', 'Payment', 'Status'].map(function (h) { return DM.el('th', { text: h }); }))]),
      ]);
      var otb = DM.el('tbody');
      recentOrders.forEach(function (o) {
        otb.appendChild(DM.el('tr', null, [
          DM.el('td', { class: 'td-code', text: o.order_code }),
          DM.el('td', { text: o.buyer_name }),
          DM.el('td', { text: o.farmer_name }),
          DM.el('td', { text: DM.money(o.total) }),
          DM.el('td', { text: o.payment_status }),
          DM.el('td', null, [DM.statusBadge(o.status, o.status === 'rejected' ? 'bad' : o.status === 'completed' ? 'good' : 'warn')]),
        ]));
      });
      orderTable.appendChild(otb);

      var container = DM.el('div', { class: 'page' }, [
        pageTitle('Admin Dashboard', 'Monitor users, products, orders and marketplace health.'),
        DM.el('div', { class: 'stats-grid' }, [
          statCard('Total users', reports.users.total),
          statCard('Farmers', byRole.farmer || 0),
          statCard('Buyers', byRole.buyer || 0),
          statCard('Products', reports.products.total),
          statCard('Pending verification', reports.products.pending, 'warn'),
          statCard('Revenue (paid)', DM.money(reports.revenue), 'good'),
        ]),
        DM.el('div', { class: 'section' }, [
          DM.el('div', { class: 'section-head' }, [DM.el('h3', { text: 'Recent orders' }), DM.el('a', { class: 'link', href: '#/admin/orders', text: 'Monitor all' })]),
          recentOrders.length === 0 ? DM.emptyState('No orders yet') : orderTable,
        ]),
        DM.el('div', { class: 'section' }, [
          DM.el('div', { class: 'section-head' }, [DM.el('h3', { text: 'Pending product verification' }), DM.el('a', { class: 'link', href: '#/admin/products', text: 'Verify products' })]),
          pendingProducts.length === 0
            ? DM.emptyState('Nothing pending', 'All products have been reviewed.')
            : renderPendingTable(pendingProducts),
        ]),
      ]);
      view.innerHTML = '';
      view.appendChild(container);
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load dashboard', e.message));
    }
  }

  function renderPendingTable(products) {
    var table = DM.el('table', { class: 'data-table' }, [
      DM.el('thead', null, [DM.el('tr', null, ['Product', 'Farmer', 'Price', 'Status', 'Actions'].map(function (h) { return DM.el('th', { text: h }); }))]),
    ]);
    var tbody = DM.el('tbody');
    products.forEach(function (p) {
      var row = DM.el('tr', null, [
        DM.el('td', { class: 'td-strong', text: p.name }),
        DM.el('td', { text: p.farmer_name }),
        DM.el('td', { text: DM.money(p.price) + '/' + p.unit }),
        DM.el('td', null, [DM.statusBadge(p.status, 'warn')]),
        DM.el('td', { class: 'actions-cell' }, [
          DM.el('button', { class: 'btn-small', text: 'Approve' }),
          DM.el('button', { class: 'btn-small btn-danger-outline', text: 'Reject' }),
        ]),
      ]);
      var btns = row.querySelectorAll('.actions-cell button');
      btns[0].addEventListener('click', async function () {
        await DM.api('PATCH', '/api/admin/products/' + p.id, { status: 'approved' });
        DM.toast('Product approved.', 'success');
        renderOverview();
      });
      btns[1].addEventListener('click', async function () {
        await DM.api('PATCH', '/api/admin/products/' + p.id, { status: 'rejected' });
        DM.toast('Product rejected.', 'error');
        renderOverview();
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    return table;
  }

  async function renderUsers() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var data = await DM.api('GET', '/api/admin/users');
      var me = DM.getStoredUser();
      var table = DM.el('table', { class: 'data-table' }, [
        DM.el('thead', null, [DM.el('tr', null, ['Name', 'Email', 'Role', 'Location', 'Status', 'Joined', 'Actions'].map(function (h) { return DM.el('th', { text: h }); }))]),
      ]);
      var tbody = DM.el('tbody');
      data.users.forEach(function (u) {
        var isSelf = String(u.id) === String(me.id);
        var row = DM.el('tr', null, [
          DM.el('td', null, [DM.el('div', { class: 'product-cell' }, [DM.profileImage(u, 'avatar'), DM.el('span', { class: 'td-strong', text: u.name + (isSelf ? ' (you)' : '') })])]),
          DM.el('td', { text: u.email }),
          DM.el('td', null, [DM.statusBadge(u.role, u.role === 'admin' ? 'neutral' : u.role === 'farmer' ? 'good' : 'warn')]),
          DM.el('td', { text: u.location || '-' }),
          DM.el('td', null, [DM.statusBadge(u.status, u.status === 'active' ? 'good' : 'bad')]),
          DM.el('td', { text: DM.formatDate(u.created_at) }),
          DM.el('td', { class: 'actions-cell' }, [
            DM.el('button', { class: 'btn-small', text: u.status === 'active' ? 'Disable' : 'Enable', disabled: isSelf ? 'disabled' : undefined }),
            DM.el('button', { class: 'btn-small btn-danger-outline', text: 'Delete', disabled: isSelf ? 'disabled' : undefined }),
          ]),
        ]);
        var btns = row.querySelectorAll('.actions-cell button');
        btns[0].addEventListener('click', async function () {
          await DM.api('PATCH', '/api/admin/users/' + u.id, { status: u.status === 'active' ? 'disabled' : 'active' });
          DM.toast('User status updated.', 'success');
          renderUsers();
        });
        btns[1].addEventListener('click', function () {
          DM.confirmDialog('Delete user', 'Delete ' + u.name + '? Their products and sessions will be removed.', async function () {
            await DM.api('DELETE', '/api/admin/users/' + u.id);
            DM.toast('User deleted.', 'success');
            renderUsers();
          });
        });
        tbody.appendChild(row);
      });
      table.appendChild(tbody);

      var container = DM.el('div', { class: 'page' }, [
        pageTitle('Manage Users', 'Disable or remove farmers, buyers and admins.'),
        DM.el('div', { class: 'section' }, [table]),
      ]);
      view.innerHTML = '';
      view.appendChild(container);
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load users', e.message));
    }
  }

  async function renderProducts() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var data = await DM.api('GET', '/api/admin/products');
      var table = DM.el('table', { class: 'data-table' }, [
        DM.el('thead', null, [DM.el('tr', null, ['Product', 'Farmer', 'Category', 'Price', 'Stock', 'Status', 'Actions'].map(function (h) { return DM.el('th', { text: h }); }))]),
      ]);
      var tbody = DM.el('tbody');
      data.products.forEach(function (p) {
        var statusMap = { pending: 'warn', approved: 'good', rejected: 'bad' };
        var row = DM.el('tr', null, [
          DM.el('td', { class: 'td-strong', text: p.name }),
          DM.el('td', { text: p.farmer_name }),
          DM.el('td', { text: p.category_name }),
          DM.el('td', { text: DM.money(p.price) + '/' + p.unit }),
          DM.el('td', { text: p.quantity }),
          DM.el('td', null, [DM.statusBadge(p.status, statusMap[p.status])]),
          DM.el('td', { class: 'actions-cell' }, [
            DM.el('button', { class: 'btn-small', text: 'Approve', disabled: p.status === 'approved' ? 'disabled' : undefined }),
            DM.el('button', { class: 'btn-small btn-danger-outline', text: 'Reject', disabled: p.status === 'rejected' ? 'disabled' : undefined }),
          ]),
        ]);
        var btns = row.querySelectorAll('.actions-cell button');
        btns[0].addEventListener('click', async function () {
          await DM.api('PATCH', '/api/admin/products/' + p.id, { status: 'approved' });
          DM.toast('Product approved.', 'success');
          renderProducts();
        });
        btns[1].addEventListener('click', async function () {
          await DM.api('PATCH', '/api/admin/products/' + p.id, { status: 'rejected' });
          DM.toast('Product rejected.', 'error');
          renderProducts();
        });
        tbody.appendChild(row);
      });
      table.appendChild(tbody);

      var container = DM.el('div', { class: 'page' }, [
        pageTitle('Verify Products', 'Approve or reject product listings before they go live.'),
        DM.el('div', { class: 'section' }, [table]),
      ]);
      view.innerHTML = '';
      view.appendChild(container);
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load products', e.message));
    }
  }

  async function renderOrders() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var data = await DM.api('GET', '/api/admin/orders');
      var table = DM.el('table', { class: 'data-table' }, [
        DM.el('thead', null, [DM.el('tr', null, ['Code', 'Date', 'Buyer', 'Farmer', 'Total', 'Payment', 'Status'].map(function (h) { return DM.el('th', { text: h }); }))]),
      ]);
      var tbody = DM.el('tbody');
      data.orders.forEach(function (o) {
        tbody.appendChild(DM.el('tr', null, [
          DM.el('td', { class: 'td-code', text: o.order_code }),
          DM.el('td', { text: DM.formatDate(o.created_at) }),
          DM.el('td', { text: o.buyer_name }),
          DM.el('td', { text: o.farmer_name }),
          DM.el('td', { text: DM.money(o.total) }),
          DM.el('td', { text: o.payment_status }),
          DM.el('td', null, [DM.statusBadge(o.status, o.status === 'rejected' ? 'bad' : o.status === 'completed' ? 'good' : 'warn')]),
        ]));
      });
      table.appendChild(tbody);

      var container = DM.el('div', { class: 'page' }, [
        pageTitle('Monitor Orders', 'All orders across the marketplace.'),
        DM.el('div', { class: 'section' }, [
          data.orders.length === 0 ? DM.emptyState('No orders yet') : table,
        ]),
      ]);
      view.innerHTML = '';
      view.appendChild(container);
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load orders', e.message));
    }
  }

  function barChart(items, valueFn, labelFn) {
    var max = items.reduce(function (m, i) {
      return Math.max(m, valueFn(i));
    }, 1);
    var wrap = DM.el('div', { class: 'bar-chart' });
    items.forEach(function (i) {
      var pct = Math.max(2, Math.round((valueFn(i) / max) * 100));
      wrap.appendChild(DM.el('div', { class: 'bar-row' }, [
        DM.el('span', { class: 'bar-label', text: labelFn(i) }),
        DM.el('div', { class: 'bar-track' }, [DM.el('div', { class: 'bar-fill', style: 'width:' + pct + '%' })]),
        DM.el('span', { class: 'bar-value', text: valueFn(i) }),
      ]));
    });
    return wrap;
  }

  async function renderReports() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var r = await DM.api('GET', '/api/admin/reports');
      var byRole = r.users.byRole.map(function (x) {
        return { label: x.role.charAt(0).toUpperCase() + x.role.slice(1) + 's', value: x.n };
      });
      var byStatus = r.orders.byStatus.map(function (x) {
        return { label: x.status, value: x.n };
      });
      var topProds = r.topProducts.map(function (x) {
        return { label: x.name, value: DM.money(x.revenue) };
      });
      var topFarms = r.topFarmers.map(function (x) {
        return { label: x.name, value: DM.money(x.revenue) };
      });

      function simpleBar(items, moneyVals) {
        var max = items.reduce(function (m, i) {
          return Math.max(m, moneyVals ? i.valueNum : i.value);
        }, 1);
        var wrap = DM.el('div', { class: 'bar-chart' });
        items.forEach(function (i) {
          var pct = Math.max(2, Math.round(((moneyVals ? i.valueNum : i.value) / max) * 100));
          wrap.appendChild(DM.el('div', { class: 'bar-row' }, [
            DM.el('span', { class: 'bar-label', text: i.label }),
            DM.el('div', { class: 'bar-track' }, [DM.el('div', { class: 'bar-fill', style: 'width:' + pct + '%' })]),
            DM.el('span', { class: 'bar-value', text: i.value }),
          ]));
        });
        return wrap;
      }

      var roleChart = simpleBar(byRole, false);
      var statusChart = simpleBar(byStatus, false);
      var prodChart = simpleBar(
        r.topProducts.map(function (x) {
          return { label: x.name, value: DM.money(x.revenue), valueNum: x.revenue };
        }),
        true
      );
      var farmChart = simpleBar(
        r.topFarmers.map(function (x) {
          return { label: x.name, value: DM.money(x.revenue), valueNum: x.revenue };
        }),
        true
      );

      var dailyChart = simpleBar(
        r.dailySales.map(function (d) {
          return { label: d.day.slice(5), value: d.revenue + ' (' + d.orders + ')', valueNum: d.revenue };
        }),
        true
      );

      var container = DM.el('div', { class: 'page' }, [
        pageTitle('Reports & Statistics', 'Marketplace performance overview.'),
        DM.el('div', { class: 'stats-grid' }, [
          statCard('Total users', r.users.total),
          statCard('Total products', r.products.total),
          statCard('Total orders', r.orders.total),
          statCard('Revenue (paid)', DM.money(r.revenue), 'good'),
        ]),
        DM.el('div', { class: 'report-grid' }, [
          DM.el('div', { class: 'section' }, [DM.el('h3', { text: 'Users by role' }), byRole.length ? roleChart : DM.emptyState('No data')]),
          DM.el('div', { class: 'section' }, [DM.el('h3', { text: 'Orders by status' }), byStatus.length ? statusChart : DM.emptyState('No data')]),
          DM.el('div', { class: 'section' }, [DM.el('h3', { text: 'Top products by revenue' }), r.topProducts.length ? prodChart : DM.emptyState('No data')]),
          DM.el('div', { class: 'section' }, [DM.el('h3', { text: 'Top farmers by revenue' }), r.topFarmers.length ? farmChart : DM.emptyState('No data')]),
          DM.el('div', { class: 'section' }, [DM.el('h3', { text: 'Daily sales (last 14 days)' }), r.dailySales.length ? dailyChart : DM.emptyState('No data')]),
        ]),
      ]);
      view.innerHTML = '';
      view.appendChild(container);
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load reports', e.message));
    }
  }

  DM.Views = DM.Views || {};
  DM.Views.admin = {
    '/overview': renderOverview,
    '/users': renderUsers,
    '/products': renderProducts,
    '/orders': renderOrders,
    '/reports': renderReports,
  };
})();
