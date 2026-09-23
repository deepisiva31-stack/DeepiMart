(function () {
  'use strict';

  var DM = window.DM;

  function pageTitle(title, sub) {
    return DM.el('div', { class: 'page-head' }, [
      DM.el('h2', { text: title }),
      sub ? DM.el('p', { class: 'page-sub', text: sub }) : null,
    ]);
  }

  function statCard(label, value, cls, statKey) {
    return DM.el('div', { class: 'stat-card ' + (cls || '') }, [
      DM.el('div', { class: 'stat-value', text: value, 'data-stat': statKey || null }),
      DM.el('div', { class: 'stat-label', text: label }),
    ]);
  }

  var STATUS_LABELS = {
    placed: 'Pending',
    accepted: 'Confirmed',
    completed: 'Delivered',
    cancelled: 'Cancelled',
    rejected: 'Cancelled',
  };

  var PAYMENT_LABELS = {
    online: 'Online',
    cod: 'Cash on delivery',
    card: 'Card',
    mobile: 'Mobile money',
  };

  var DELIVERY_LABELS = {
    processing: 'Processing',
    packed: 'Packed',
    in_transit: 'In transit',
    out_for_delivery: 'Out for delivery',
    delivered: 'Delivered',
  };

  function cap(text) {
    var t = String(text == null ? '' : text);
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function orderStatusBadge(o) {
    var tone = o.status === 'rejected' || o.status === 'cancelled' ? 'bad' : o.status === 'completed' ? 'good' : 'warn';
    return DM.statusBadge(STATUS_LABELS[o.status] || cap(o.status), tone);
  }

  function buildStatusChart(reports) {
    var items = (reports.orders && reports.orders.byStatus) || [];
    if (!items.length) return DM.emptyState('No orders yet');
    return barChart(
      items,
      function (i) { return i.n; },
      function (i) { return STATUS_LABELS[i.status] || i.status; }
    );
  }

  var overviewTimer = null;
  function stopOverviewRefresh() {
    if (overviewTimer) {
      clearInterval(overviewTimer);
      overviewTimer = null;
    }
  }

  async function refreshOverviewStats() {
    if ((location.hash || '').indexOf('#/admin/overview') !== 0) {
      stopOverviewRefresh();
      return;
    }
    if (document.querySelector('.modal-backdrop')) return;
    try {
      var reports = await DM.api('GET', '/api/admin/reports');
      var s = reports.summary || {};
      var vals = {
        users: s.users,
        buyers: s.buyers,
        sellers: s.sellers,
        products: s.products,
        orders: s.orders,
        delivered: s.delivered,
        pending: s.pending,
        cancelled: s.cancelled,
        pendingProducts: (reports.products && reports.products.pending) || 0,
        revenue: DM.money(reports.revenue),
      };
      document.querySelectorAll('[data-stat]').forEach(function (node) {
        var key = node.getAttribute('data-stat');
        if (key in vals) node.textContent = vals[key];
      });
      var chartBox = document.getElementById('overview-status-chart');
      if (chartBox) {
        chartBox.innerHTML = '';
        chartBox.appendChild(buildStatusChart(reports));
      }
    } catch (e) {
      /* keep showing the last values on transient errors */
    }
  }

  async function renderOverview() {
    DM.setView(DM.skeleton());
    stopOverviewRefresh();
    var view = document.getElementById('view');
    try {
      var reports = await DM.api('GET', '/api/admin/reports');
      var users = await DM.api('GET', '/api/admin/users');
      var products = await DM.api('GET', '/api/admin/products');
      var orders = await DM.api('GET', '/api/admin/orders');

      var s = reports.summary || {};

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
          DM.el('td', null, [orderStatusBadge(o)]),
        ]));
      });
      orderTable.appendChild(otb);

      var container = DM.el('div', { class: 'page' }, [
        pageTitle('Admin Dashboard', 'Monitor users, products, orders and marketplace health.'),
        DM.el('div', { class: 'stats-grid' }, [
          statCard('Total Buyers', s.buyers, '', 'buyers'),
          statCard('Total Sellers', s.sellers, '', 'sellers'),
          statCard('Total Products', s.products, '', 'products'),
          statCard('Total Orders', s.orders, '', 'orders'),
          statCard('Delivered Orders', s.delivered, 'good', 'delivered'),
          statCard('Pending Orders', s.pending, 'warn', 'pending'),
          statCard('Cancelled Orders', s.cancelled, '', 'cancelled'),
          statCard('Pending verification', reports.products.pending, 'warn', 'pendingProducts'),
          statCard('Revenue (paid)', DM.money(reports.revenue), 'good', 'revenue'),
        ]),
        DM.el('div', { class: 'section' }, [
          DM.el('div', { class: 'section-head' }, [DM.el('h3', { text: 'Orders by status' }), DM.el('a', { class: 'link', href: '#/admin/reports', text: 'Full reports' })]),
          DM.el('div', { id: 'overview-status-chart' }, [buildStatusChart(reports)]),
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
      overviewTimer = setInterval(refreshOverviewStats, 15000);
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
          DM.el('button', { class: 'btn-small', text: 'View' }),
          DM.el('button', { class: 'btn-small', text: 'Approve' }),
          DM.el('button', { class: 'btn-small btn-danger-outline', text: 'Reject' }),
        ]),
      ]);
      var btns = row.querySelectorAll('.actions-cell button');
      btns[0].addEventListener('click', function () {
        openProductDetails(p);
      });
      btns[1].addEventListener('click', async function () {
        await DM.api('PATCH', '/api/admin/products/' + p.id, { status: 'approved' });
        DM.toast('Product approved.', 'success');
        renderOverview();
      });
      btns[2].addEventListener('click', async function () {
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
            DM.el('button', { class: 'btn-small', text: 'View' }),
            DM.el('button', { class: 'btn-small', text: u.status === 'active' ? 'Disable' : 'Enable', disabled: isSelf ? 'disabled' : undefined }),
            DM.el('button', { class: 'btn-small btn-danger-outline', text: 'Delete', disabled: isSelf ? 'disabled' : undefined }),
          ]),
        ]);
        var btns = row.querySelectorAll('.actions-cell button');
        btns[0].addEventListener('click', function () {
          openUserDetails(u);
        });
        btns[1].addEventListener('click', async function () {
          await DM.api('PATCH', '/api/admin/users/' + u.id, { status: u.status === 'active' ? 'disabled' : 'active' });
          DM.toast('User status updated.', 'success');
          renderUsers();
        });
        btns[2].addEventListener('click', function () {
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
            DM.el('button', { class: 'btn-small', text: 'View' }),
            DM.el('button', { class: 'btn-small', text: 'Approve', disabled: p.status === 'approved' ? 'disabled' : undefined }),
            DM.el('button', { class: 'btn-small btn-danger-outline', text: 'Reject', disabled: p.status === 'rejected' ? 'disabled' : undefined }),
          ]),
        ]);
        var btns = row.querySelectorAll('.actions-cell button');
        btns[0].addEventListener('click', function () {
          openProductDetails(p);
        });
        btns[1].addEventListener('click', async function () {
          await DM.api('PATCH', '/api/admin/products/' + p.id, { status: 'approved' });
          DM.toast('Product approved.', 'success');
          renderProducts();
        });
        btns[2].addEventListener('click', async function () {
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
        DM.el('thead', null, [DM.el('tr', null, ['Code', 'Date', 'Buyer', 'Farmer', 'Total', 'Payment', 'Status', 'Actions'].map(function (h) { return DM.el('th', { text: h }); }))]),
      ]);
      var tbody = DM.el('tbody');
      data.orders.forEach(function (o) {
        var row = DM.el('tr', null, [
          DM.el('td', { class: 'td-code', text: o.order_code }),
          DM.el('td', { text: DM.formatDate(o.created_at) }),
          DM.el('td', { text: o.buyer_name }),
          DM.el('td', { text: o.farmer_name }),
          DM.el('td', { text: DM.money(o.total) }),
          DM.el('td', { text: o.payment_status }),
          DM.el('td', null, [orderStatusBadge(o)]),
          DM.el('td', { class: 'actions-cell' }, [DM.el('button', { class: 'btn-small', text: 'View' })]),
        ]);
        row.querySelector('.actions-cell button').addEventListener('click', function () {
          openOrderDetails(o.id);
        });
        tbody.appendChild(row);
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

  function infoRow(label, value) {
    var text = value === null || value === undefined || value === '' ? '\u2014' : String(value);
    return DM.el('div', { class: 'info-item' }, [DM.el('span', { class: 'info-label', text: label }), DM.el('span', { text: text })]);
  }

  function modalFooter() {
    var closeBtn = DM.el('button', { class: 'btn-ghost', text: 'Close' });
    var m = { el: null };
    var foot = DM.el('div', { class: 'btn-row' }, [closeBtn]);
    closeBtn.addEventListener('click', function () {
      if (m.el) m.el.close();
    });
    m.foot = foot;
    return { foot: foot, setModal: function (mod) { m.el = mod; } };
  }

  function openUserDetails(u) {
    var head = DM.el('div', { class: 'product-cell' }, [
      DM.profileImage(u, 'avatar'),
      DM.el('div', null, [
        DM.el('h3', { text: u.name }),
        DM.el('p', { class: 'page-sub', text: u.email }),
      ]),
    ]);
    var rows = [
      infoRow('Role', cap(u.role)),
      infoRow('Phone', u.phone),
      infoRow('Location', u.location),
      infoRow('Status', cap(u.status)),
      infoRow('Joined', DM.formatDate(u.created_at)),
    ];
    if (u.role === 'farmer') rows.push(infoRow('Products listed', u.product_count));
    if (u.role === 'buyer') rows.push(infoRow('Orders placed', u.order_count));
    var body = DM.el('div', null, [head, DM.el('div', { class: 'info-grid' }, rows)]);
    var footer = modalFooter();
    var modal = DM.openModal(body, { title: u.role === 'farmer' ? 'Seller details' : u.role === 'buyer' ? 'Buyer details' : 'User details', footer: footer.foot });
    footer.setModal(modal);
  }

  function openProductDetails(p) {
    var statusMap = { pending: 'warn', approved: 'good', rejected: 'bad' };
    var img = DM.el('img', {
      class: 'thumb',
      alt: p.name,
      loading: 'lazy',
      src: DM.productImage({ photo: p.photo || '', name: p.name }),
    });
    img.onerror = function () {
      img.onerror = null;
      img.src = DM.defaultProductImage(p.name, p.category_name);
    };
    var head = DM.el('div', { class: 'product-cell' }, [
      img,
      DM.el('div', null, [
        DM.el('h3', { text: p.name }),
        DM.el('p', { class: 'page-sub', text: p.farmer_name + ' \u00b7 ' + p.category_name }),
      ]),
    ]);
    var rows = [
      infoRow('Price', DM.money(p.price) + ' / ' + p.unit),
      infoRow('Stock available', p.quantity + ' ' + p.unit),
      infoRow('Location', p.location),
      infoRow('Harvest date', p.harvest_date),
      infoRow('Freshness', p.freshness),
    ];
    var body = DM.el('div', null, [head, DM.el('div', { class: 'info-grid' }, rows)]);
    if (p.description) body.appendChild(DM.el('p', { class: 'page-sub', text: p.description }));
    body.appendChild(DM.el('div', { style: 'margin-top:12px' }, [DM.statusBadge(p.status, statusMap[p.status] || 'warn'), DM.el('span', { class: 'page-sub', text: '  Listed on ' + DM.formatDate(p.created_at) })]));
    var footer = modalFooter();
    var modal = DM.openModal(body, { title: 'Product details', footer: footer.foot });
    footer.setModal(modal);
  }

  async function openOrderDetails(orderId) {
    try {
      var data = await DM.api('GET', '/api/orders/' + orderId);
      var o = data.order;
      var itemsTable = DM.el('table', { class: 'data-table' }, [
        DM.el('thead', null, [DM.el('tr', null, ['Product', 'Qty', 'Unit price', 'Subtotal'].map(function (h) { return DM.el('th', { text: h }); }))]),
      ]);
      var itb = DM.el('tbody');
      o.items.forEach(function (it) {
        itb.appendChild(DM.el('tr', null, [
          DM.el('td', { class: 'td-strong', text: it.product_name }),
          DM.el('td', { text: it.quantity }),
          DM.el('td', { text: DM.money(it.unit_price) }),
          DM.el('td', { text: DM.money(it.subtotal) }),
        ]));
      });
      itemsTable.appendChild(itb);

      var buyerText = o.buyer ? o.buyer.name + (o.buyer.email ? ' (' + o.buyer.email + ')' : '') : '-';
      var paymentText = (o.payment && PAYMENT_LABELS[o.payment.method]) || cap(o.paymentStatus) || '-';
      var body = DM.el('div', null, [
        DM.el('div', { class: 'info-grid' }, [
          infoRow('Order date', DM.formatDate(o.createdAt)),
          infoRow('Buyer', buyerText),
          infoRow('Seller', o.farmer ? o.farmer.name : '-'),
          infoRow('Delivery address', o.deliveryAddress),
          infoRow('Payment', paymentText),
          infoRow('Order status', STATUS_LABELS[o.status] || cap(o.status)),
          infoRow('Tracking', o.delivery ? o.delivery.trackingCode : '-'),
          infoRow('Delivery status', o.delivery && o.delivery.status ? (DELIVERY_LABELS[o.delivery.status] || cap(o.delivery.status)) : 'Not shipped yet'),
          infoRow('Total', DM.money(o.total)),
        ]),
        DM.el('h3', { text: 'Items' }),
        itemsTable,
      ]);
      var footer = modalFooter();
      var modal = DM.openModal(body, { title: 'Order ' + o.orderCode, size: 'lg', footer: footer.foot });
      footer.setModal(modal);
    } catch (e) {
      DM.toast(e.message, 'error');
    }
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
