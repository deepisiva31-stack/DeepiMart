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

  async function loadStats() {
    var products = await DM.api('GET', '/api/farmer/products');
    var orders = await DM.api('GET', '/api/orders/farmer');
    return { products: products.products, orders: orders.orders };
  }

  async function renderOverview() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    var me = DM.getStoredUser();
    try {
      var d = await loadStats();
      var approved = d.products.filter(function (p) {
        return p.status === 'approved';
      });
      var pending = d.products.filter(function (p) {
        return p.status === 'pending';
      });
      var pendingOrders = d.orders.filter(function (o) {
        return o.status === 'placed';
      });
      var revenue = d.orders
        .filter(function (o) {
          return o.paymentStatus === 'paid' && o.status !== 'cancelled' && o.status !== 'rejected';
        })
        .reduce(function (s, o) {
          return s + o.total;
        }, 0);
      var recent = d.orders.slice(0, 5);

      var container = DM.el('div', { class: 'page' }, [
        pageTitle('Farmer Dashboard', 'Welcome back, ' + me.name + '. Manage your products and orders.'),
        DM.el('div', { class: 'stats-grid' }, [
          statCard('My Products', d.products.length),
          statCard('Approved', approved.length, 'good'),
          statCard('Pending verification', pending.length, 'warn'),
          statCard('Pending orders', pendingOrders.length),
          statCard('Revenue (paid)', DM.money(revenue), 'good'),
        ]),
        DM.el('div', { class: 'section' }, [
          DM.el('div', { class: 'section-head' }, [
            DM.el('h3', { text: 'Recent orders' }),
            DM.el('a', { class: 'link', href: '#/farmer/orders', text: 'View all orders' }),
          ]),
          recent.length === 0
            ? DM.emptyState('No orders yet', 'When buyers order your produce, they will appear here.')
            : renderOrdersTable(recent),
        ]),
        DM.el('div', { class: 'btn-row' }, [
          DM.el('a', { class: 'btn-primary', href: '#/farmer/products/add', text: '+ Add Product' }),
          DM.el('a', { class: 'btn-ghost', href: '#/farmer/products', text: 'Manage products' }),
          DM.el('a', { class: 'btn-ghost', href: '#/farmer/sales', text: 'Sales history' }),
        ]),
      ]);
      view.innerHTML = '';
      view.appendChild(container);
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load dashboard', e.message));
    }
  }

  function renderOrdersTable(orders) {
    var table = DM.el('table', { class: 'data-table' }, [
      DM.el('thead', null, [
        DM.el('tr', null, ['Order', 'Buyer', 'Items', 'Total', 'Payment', 'Status', ''].map(function (h) {
          return DM.el('th', { text: h });
        })),
      ]),
    ]);
    var tbody = DM.el('tbody');
    orders.forEach(function (o) {
      var statusMap = {
        placed: 'warn',
        accepted: 'good',
        rejected: 'bad',
        completed: 'good',
        cancelled: 'neutral',
      };
      tbody.appendChild(
        DM.el('tr', null, [
          DM.el('td', { class: 'td-code', text: o.orderCode }),
          DM.el('td', { text: o.buyer.name }),
          DM.el('td', { text: String(o.items.length) }),
          DM.el('td', { text: DM.money(o.total) }),
          DM.el('td', { text: o.paymentStatus }),
          DM.el('td', null, [DM.statusBadge(o.status, statusMap[o.status])]),
          DM.el('td', null, [
            DM.el('button', { class: 'btn-small', text: 'Details' }),
          ]),
        ])
      );
      tbody.lastChild.querySelector('button').addEventListener('click', function () {
        openOrderDetails(o.id);
      });
    });
    table.appendChild(tbody);
    return table;
  }

  async function openOrderDetails(orderId) {
    try {
      var data = await DM.api('GET', '/api/orders/' + orderId);
      var o = data.order;
      var items = o.items
        .map(function (i) {
          return DM.el('tr', null, [
          DM.el('td', { text: i.product_name }),
          DM.el('td', { text: DM.money(i.unit_price) }),
          DM.el('td', { text: i.quantity }),
            DM.el('td', { text: DM.money(i.subtotal) }),
          ]);
        })
        .reduce(function (acc, tr) {
          acc.appendChild(tr);
          return acc;
        }, DM.el('tbody'));

      var body = DM.el('div', { class: 'order-detail' }, [
        DM.el('p', null, [
          DM.el('strong', { text: o.orderCode }),
          DM.el('span', { text: ' - ' + DM.formatDate(o.createdAt) }),
        ]),
        DM.el('p', { text: 'Buyer: ' + o.buyer.name + ' (' + o.buyer.phone + ') - ' + o.deliveryAddress }),
        DM.el('table', { class: 'data-table' }, [
          DM.el('thead', null, [DM.el('tr', null, ['Product', 'Price', 'Qty', 'Subtotal'].map(function (h) { return DM.el('th', { text: h }); }))]),
          items,
          DM.el('tfoot', null, [DM.el('tr', null, [DM.el('td', { colspan: '3', class: 'ta-r', text: 'Total' }), DM.el('td', { text: DM.money(o.total) })])]),
        ]),
        DM.el('p', { text: 'Payment: ' + o.paymentStatus + '  |  Delivery: ' + (o.delivery ? o.delivery.trackingCode + ' (' + o.delivery.status + ')' : 'n/a') }),
      ]);

      var actions = [];
      if (o.status === 'placed') {
        var acceptBtn = DM.el('button', { class: 'btn-primary', text: 'Accept order' });
        acceptBtn.addEventListener('click', async function () {
          await DM.api('PATCH', '/api/orders/' + o.id, { action: 'accept' });
          DM.toast('Order accepted.', 'success');
          DM.closeModal();
          renderOverview();
        });
        var rejectBtn = DM.el('button', { class: 'btn-danger', text: 'Reject order' });
        rejectBtn.addEventListener('click', async function () {
          await DM.api('PATCH', '/api/orders/' + o.id, { action: 'reject' });
          DM.toast('Order rejected.', 'error');
          DM.closeModal();
          renderOverview();
        });
        actions.push(rejectBtn, acceptBtn);
      } else if (o.status === 'accepted' && o.paymentStatus === 'paid') {
        var completeBtn = DM.el('button', { class: 'btn-primary', text: 'Mark delivered / complete' });
        completeBtn.addEventListener('click', async function () {
          await DM.api('PATCH', '/api/orders/' + o.id, { action: 'complete' });
          DM.toast('Order completed.', 'success');
          DM.closeModal();
          renderOverview();
        });
        actions.push(completeBtn);
      }
      var foot = DM.el('div', { class: 'btn-row' }, actions.length ? actions : [DM.el('button', { class: 'btn-ghost', text: 'Close' })]);
      if (actions.length) {
        foot.appendChild(DM.el('button', { class: 'btn-ghost', text: 'Close' }));
      }
      DM.openModal(body, { title: 'Order details', footer: foot, size: 'lg' });
    } catch (e) {
      DM.toast(e.message, 'error');
    }
  }

  async function renderProducts() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var data = await DM.api('GET', '/api/farmer/products');
      var container = DM.el('div', { class: 'page' }, [
        pageTitle('My Products', 'Add, edit and manage your produce listings.'),
        DM.el('div', { class: 'section' }, [
          DM.el('div', { class: 'section-head' }, [
            DM.el('h3', { text: 'Products (' + data.products.length + ')' }),
            DM.el('a', { class: 'btn-primary btn-sm', href: '#/farmer/products/add', text: '+ Add Product' }),
          ]),
          data.products.length === 0
            ? DM.emptyState('No products yet', 'Add your first product to start selling.')
            : renderProductTable(data.products),
        ]),
      ]);
      view.innerHTML = '';
      view.appendChild(container);
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load products', e.message));
    }
  }

  function renderProductTable(products) {
    var table = DM.el('table', { class: 'data-table' }, [
      DM.el('thead', null, [
        DM.el('tr', null, ['Product', 'Category', 'Price', 'Stock', 'Harvest', 'Status', 'Actions'].map(function (h) {
          return DM.el('th', { text: h });
        })),
      ]),
    ]);
    var tbody = DM.el('tbody');
    products.forEach(function (p) {
      var statusMap = { pending: 'warn', approved: 'good', rejected: 'bad' };
      var row = DM.el('tr', null, [
        DM.el('td', null, [
          DM.el('div', { class: 'product-cell' }, [
            DM.el('img', { class: 'thumb', src: p.photo || DM.placeholderImage(p.category.name), alt: p.name }),
            DM.el('span', { class: 'td-strong', text: p.name }),
          ]),
        ]),
        DM.el('td', { text: p.category.name }),
        DM.el('td', { text: DM.money(p.price) + '/' + p.unit }),
        DM.el('td', { text: p.quantity }),
        DM.el('td', { text: p.harvestDate || '-' }),
        DM.el('td', null, [DM.statusBadge(p.status, statusMap[p.status])]),
        DM.el('td', { class: 'actions-cell' }, [
          DM.el('button', { class: 'btn-small', text: 'Stock' }),
          DM.el('a', { class: 'btn-small', href: '#/farmer/products/edit/' + p.id, text: 'Edit' }),
          DM.el('button', { class: 'btn-small btn-danger-outline', text: 'Delete' }),
        ]),
      ]);
      var buttons = row.querySelectorAll('.actions-cell button');
      buttons[0].addEventListener('click', function () {
        openStockModal(p);
      });
      buttons[1].addEventListener('click', function () {
        DM.confirmDialog('Delete product', 'Delete "' + p.name + '"? This cannot be undone.', async function () {
          try {
            await DM.api('DELETE', '/api/farmer/products/' + p.id);
            DM.toast('Product deleted.', 'success');
            renderProducts();
          } catch (e) {
            DM.toast(e.message, 'error');
          }
        });
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    return table;
  }

  function openStockModal(p) {
    var qtyInput = DM.el('input', { type: 'number', min: '0', step: 'any', value: p.quantity, id: 'stock-qty' });
    var body = DM.el('div', { class: 'form-grid' }, [
      DM.field('Available stock (' + p.unit + ')', qtyInput),
    ]);
    var saveBtn = DM.el('button', { class: 'btn-primary', text: 'Save stock' });
    var cancelBtn = DM.el('button', { class: 'btn-ghost', text: 'Cancel' });
    var foot = DM.el('div', { class: 'btn-row' }, [cancelBtn, saveBtn]);
    var modal = DM.openModal(body, { title: 'Update stock - ' + p.name, footer: foot });
    saveBtn.addEventListener('click', async function () {
      try {
        await DM.api('PATCH', '/api/farmer/products/' + p.id + '/stock', { quantity: Number(qtyInput.value) });
        DM.toast('Stock updated.', 'success');
        modal.close();
        renderProducts();
      } catch (e) {
        DM.toast(e.message, 'error');
      }
    });
    cancelBtn.addEventListener('click', modal.close);
  }

  async function loadCategories() {
    var data = await DM.api('GET', '/api/categories');
    return data.categories;
  }

  function productFormHtml(product, categories) {
    var p = product || {
      name: '',
      description: '',
      categoryId: '',
      price: '',
      unit: 'kg',
      quantity: '',
      harvestDate: '',
      freshness: '',
      location: '',
      photo: '',
    };
    var photoPreview = p.photo ? p.photo : DM.placeholderImage((categories[0] || {}).name || 'produce');
    var form = DM.el('form', { id: 'product-form', class: 'form' });
    var photoInput = DM.el('input', { type: 'file', accept: 'image/*', id: 'product-photo' });
    var img = DM.el('img', { class: 'photo-preview', src: photoPreview, alt: 'Product photo', id: 'product-photo-preview' });
    var photoField = DM.el('div', { class: 'field' }, [
      DM.el('label', { text: 'Product photo' }),
      DM.el('div', { class: 'photo-upload' }, [img, DM.el('label', { class: 'btn-ghost btn-sm', html: 'Choose photo' }), photoInput]),
      DM.el('p', { class: 'field-hint', text: 'JPG or PNG under 1.5 MB works best.' }),
    ]);

    var catOptions = categories.map(function (c) {
      return DM.el('option', { value: String(c.id), text: c.name, selected: p.categoryId === c.id ? 'selected' : undefined });
    });
    var catSelect = DM.el('select', { id: 'product-category', required: 'required' }, catOptions);
    var unitOptions = ['kg', 'tray', 'bunch', 'piece', 'bag', 'litre'].map(function (u) {
      return DM.el('option', { value: u, text: u, selected: p.unit === u ? 'selected' : undefined });
    });
    var unitSelect = DM.el('select', { id: 'product-unit', required: 'required' }, unitOptions);

    var photoData = p.photo;
    photoInput.addEventListener('change', function () {
      var file = photoInput.files && photoInput.files[0];
      if (!file) return;
      if (file.size > 1.5 * 1024 * 1024) {
        DM.toast('Image is too large (max 1.5 MB).', 'error');
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        photoData = e.target.result;
        img.src = photoData;
      };
      reader.readAsDataURL(file);
    });

    var grid = DM.el('div', { class: 'form-grid' }, [
      DM.field('Product name', DM.el('input', { type: 'text', id: 'product-name', required: 'required', maxlength: '120', value: p.name, placeholder: 'e.g. Fresh Tomatoes' })),
      DM.field('Category', catSelect),
      DM.field('Price', DM.el('input', { type: 'number', id: 'product-price', required: 'required', min: '1', step: 'any', value: p.price, placeholder: 'e.g. 3000' })),
      DM.field('Unit', unitSelect),
      DM.field('Quantity in stock', DM.el('input', { type: 'number', id: 'product-quantity', required: 'required', min: '0', step: 'any', value: p.quantity })),
      DM.field('Harvest date', DM.el('input', { type: 'date', id: 'product-harvest', value: p.harvestDate })),
      DM.field('Freshness info', DM.el('input', { type: 'text', id: 'product-freshness', maxlength: '200', value: p.freshness, placeholder: 'e.g. Harvested this morning' })),
      DM.field('Farm location', DM.el('input', { type: 'text', id: 'product-location', maxlength: '120', value: p.location || '', placeholder: 'e.g. Kampala, Uganda' })),
      DM.field('Description', DM.el('textarea', { id: 'product-description', rows: '4', maxlength: '2000', placeholder: 'Describe your produce...', text: p.description })),
    ]);

    form.appendChild(DM.el('div', { class: 'section' }, [
      photoField,
      grid,
      DM.el('div', { class: 'btn-row' }, [
        DM.el('button', { type: 'submit', class: 'btn-primary', text: product ? 'Save changes' : 'Add product' }),
        DM.el('a', { class: 'btn-ghost', href: '#/farmer/products', text: 'Cancel' }),
      ]),
    ]));

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var payload = {
        name: document.getElementById('product-name').value.trim(),
        description: document.getElementById('product-description').value.trim(),
        categoryId: Number(document.getElementById('product-category').value),
        price: Number(document.getElementById('product-price').value),
        unit: document.getElementById('product-unit').value,
        quantity: Number(document.getElementById('product-quantity').value),
        harvestDate: document.getElementById('product-harvest').value,
        freshness: document.getElementById('product-freshness').value.trim(),
        location: document.getElementById('product-location').value.trim(),
        photo: photoData,
      };
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        if (product) {
          await DM.api('PUT', '/api/farmer/products/' + product.id, payload);
          DM.toast('Product updated.', 'success');
        } else {
          await DM.api('POST', '/api/farmer/products', payload);
          DM.toast('Product added. It needs admin verification to go live.', 'success');
        }
        window.location.hash = '#/farmer/products';
      } catch (err) {
        DM.toast(err.message, 'error');
        btn.disabled = false;
      }
    });
    return form;
  }

  async function renderProductForm(editId) {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var categories = await loadCategories();
      var product = null;
      if (editId) {
        var data = await DM.api('GET', '/api/farmer/products');
        product = data.products.filter(function (p) {
          return String(p.id) === String(editId);
        })[0];
        if (!product) throw new Error('Product not found.');
      }
      var container = DM.el('div', { class: 'page' }, [
        pageTitle(editId ? 'Edit Product' : 'Add Product', editId ? 'Update the details of ' + product.name + '.' : 'List your produce for buyers to discover.'),
        productFormHtml(product, categories),
      ]);
      view.innerHTML = '';
      view.appendChild(container);
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load form', e.message));
    }
  }

  async function renderOrders() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var data = await DM.api('GET', '/api/orders/farmer');
      var container = DM.el('div', { class: 'page' }, [
        pageTitle('Orders', 'Accept or reject incoming orders.'),
        DM.el('div', { class: 'section' }, [
          data.orders.length === 0
            ? DM.emptyState('No orders yet', 'Orders will appear here when buyers purchase your products.')
            : renderOrdersTable(data.orders),
        ]),
      ]);
      view.innerHTML = '';
      view.appendChild(container);
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load orders', e.message));
    }
  }

  async function renderSales() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var data = await DM.api('GET', '/api/orders/farmer');
      var completed = data.orders.filter(function (o) {
        return o.status === 'completed';
      });
      var revenue = completed.reduce(function (s, o) {
        return s + o.total;
      }, 0);
      var unitTotal = completed.reduce(function (s, o) {
        return s + o.items.reduce(function (ss, i) {
          return ss + i.quantity;
        }, 0);
      }, 0);

      var rows = [];
      completed.forEach(function (o) {
        o.items.forEach(function (i) {
          rows.push({ order: o, item: i });
        });
      });
      rows.reverse();

      var table = DM.el('table', { class: 'data-table' }, [
        DM.el('thead', null, [
          DM.el('tr', null, ['Date', 'Order', 'Product', 'Qty', 'Unit price', 'Subtotal'].map(function (h) { return DM.el('th', { text: h }); })),
        ]),
      ]);
      var tbody = DM.el('tbody');
      rows.forEach(function (r) {
        tbody.appendChild(
          DM.el('tr', null, [
            DM.el('td', { text: DM.formatDate(r.order.createdAt) }),
            DM.el('td', { class: 'td-code', text: r.order.orderCode }),
            DM.el('td', { text: r.item.product_name }),
            DM.el('td', { text: r.item.quantity }),
            DM.el('td', { text: DM.money(r.item.unit_price) }),
            DM.el('td', { text: DM.money(r.item.subtotal) }),
          ])
        );
      });
      table.appendChild(tbody);

      var container = DM.el('div', { class: 'page' }, [
        pageTitle('Sales History', 'Completed sales from your farm.'),
        DM.el('div', { class: 'stats-grid' }, [
          statCard('Completed orders', completed.length, 'good'),
          statCard('Units sold', unitTotal, 'good'),
          statCard('Total revenue', DM.money(revenue), 'good'),
        ]),
        DM.el('div', { class: 'section' }, [
          rows.length === 0 ? DM.emptyState('No completed sales yet', 'Completed orders will appear here.') : table,
        ]),
      ]);
      view.innerHTML = '';
      view.appendChild(container);
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load sales', e.message));
    }
  }

  DM.Views = DM.Views || {};
  DM.Views.farmer = {
    '/overview': renderOverview,
    '/products': renderProducts,
    '/products/add': function () {
      return renderProductForm(null);
    },
    '/products/edit/:id': function (params) {
      return renderProductForm(params.id);
    },
    '/orders': renderOrders,
    '/sales': renderSales,
  };
})();
