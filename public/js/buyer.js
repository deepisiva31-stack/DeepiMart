(function () {
  'use strict';

  var DM = window.DM;

  function pageTitle(title, sub) {
    return DM.el('div', { class: 'page-head' }, [
      DM.el('h2', { text: title }),
      sub ? DM.el('p', { class: 'page-sub', text: sub }) : null,
    ]);
  }

  function freshnessBadge(p) {
    var f = DM.freshness(p.harvestDate);
    return DM.statusBadge(f.label, f.cls);
  }

  function wishlistBtn(productId) {
    var btn = DM.el('button', { class: 'wishlist-btn', 'aria-label': 'Toggle wishlist', html: '&#9825;' });
    DM.api('GET', '/api/wishlist/check/' + productId)
      .then(function (data) {
        if (data.wishlisted) {
          btn.classList.add('wishlisted');
          btn.innerHTML = '&#9829;';
        }
      })
      .catch(function () {});
    btn.addEventListener('click', async function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (btn.classList.contains('wishlisted')) {
        try {
          await DM.api('DELETE', '/api/wishlist/' + productId);
          btn.classList.remove('wishlisted');
          btn.innerHTML = '&#9825;';
          DM.toast('Removed from wishlist.', 'success');
        } catch (e) {
          DM.toast(e.message, 'error');
        }
      } else {
        try {
          await DM.api('POST', '/api/wishlist', { productId: productId });
          btn.classList.add('wishlisted');
          btn.innerHTML = '&#9829;';
          DM.toast('Added to wishlist.', 'success');
        } catch (e) {
          DM.toast(e.message, 'error');
        }
      }
    });
    return btn;
  }

  function starsHtml(rating, count) {
    var full = Math.floor(rating);
    var half = rating - full >= 0.5 ? 1 : 0;
    var empty = 5 - full - half;
    var html = '<span class="star-rating">';
    for (var i = 0; i < full; i++) html += '<span class="star filled">&#9733;</span>';
    if (half) html += '<span class="star half">&#9733;</span>';
    for (var i = 0; i < empty; i++) html += '<span class="star">&#9734;</span>';
    html += '</span>';
    if (count !== undefined) {
      html += ' <span class="review-count-inline">(' + count + ')</span>';
    }
    return html;
  }

  function starsInputHtml(name, current) {
    var html = '<span class="star-input">';
    for (var i = 1; i <= 5; i++) {
      html += '<label class="star-label"><input type="radio" name="' + name + '" value="' + i + '"' + (i === current ? ' checked' : '') + '><span class="star' + (i <= current ? ' filled' : '') + '">&#9733;</span></label>';
    }
    html += '</span>';
    return html;
  }

  function productCard(p) {
    var ratingHtml = p.averageRating > 0 ? '<p class="pc-meta pc-rating">' + starsHtml(p.averageRating, p.reviewCount) + '</p>' : '';
    var card = DM.el('div', { class: 'product-card' }, [
      DM.el('div', { class: 'product-card-img' }, [
        DM.el('img', { src: DM.productImage(p), alt: p.name, loading: 'lazy' }),
        freshnessBadge(p),
        wishlistBtn(p.id),
      ]),
      DM.el('div', { class: 'product-card-body' }, [
        DM.el('h4', { text: p.name }),
        DM.el('p', { class: 'pc-price', text: DM.money(p.price) + ' / ' + p.unit }),
        ratingHtml ? DM.el('div', { html: ratingHtml }) : null,
        DM.el('p', { class: 'pc-meta', html: '<strong>' + DM.esc(p.farmer.name) + '</strong>' + (p.location ? ' - ' + DM.esc(p.location) : '') }),
        DM.el('p', { class: 'pc-meta', text: p.quantity > 0 ? 'In stock: ' + p.quantity + ' ' + p.unit : 'Out of stock' }),
        DM.el('div', { class: 'btn-row' }, [
          DM.el('a', { class: 'btn-primary btn-sm', href: '#/buyer/product/' + p.id, text: 'View' }),
          DM.el('button', { class: 'btn-ghost btn-sm', text: 'Add to cart', disabled: p.quantity <= 0 ? 'disabled' : undefined }),
        ]),
      ]),
    ]);
    var addBtn = card.querySelector('.btn-ghost');
    if (!p.quantity || p.quantity <= 0) {
      addBtn.disabled = true;
    } else {
      addBtn.addEventListener('click', async function () {
        try {
          await DM.api('POST', '/api/cart', { productId: p.id, quantity: 1 });
          DM.toast('Added to cart.', 'success');
          refreshCartBadge();
        } catch (e) {
          DM.toast(e.message, 'error');
        }
      });
    }
    return card;
  }

  async function refreshCartBadge() {
    var badge = document.getElementById('nav-cart-badge');
    if (!badge) return;
    try {
      var data = await DM.api('GET', '/api/cart');
      var n = data.items.length;
      badge.textContent = n;
      badge.classList.toggle('hidden', n === 0);
    } catch (e) {}
  }

  // ---------------- Marketplace ----------------
  var filters = { q: '', category: '', minPrice: '', maxPrice: '', location: '', sort: 'newest' };

  async function fetchProducts() {
    var params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.category) params.set('category', filters.category);
    if (filters.minPrice) params.set('minPrice', filters.minPrice);
    if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);
    if (filters.location) params.set('location', filters.location);
    if (filters.sort) params.set('sort', filters.sort);
    return DM.api('GET', '/api/products?' + params.toString());
  }

  async function renderMarket() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var [productsData, catData] = await Promise.all([fetchProducts(), DM.api('GET', '/api/categories')]);

      var searchInput = DM.el('input', { type: 'search', id: 'mkt-q', placeholder: 'Search produce...', value: filters.q, 'aria-label': 'Search products' });
      var locationInput = DM.el('input', { type: 'text', id: 'mkt-loc', placeholder: 'Location, e.g. Kampala', value: filters.location, 'aria-label': 'Location' });
      var minInput = DM.el('input', { type: 'number', id: 'mkt-min', placeholder: 'Min price', value: filters.minPrice, min: '0', 'aria-label': 'Minimum price' });
      var maxInput = DM.el('input', { type: 'number', id: 'mkt-max', placeholder: 'Max price', value: filters.maxPrice, min: '0', 'aria-label': 'Maximum price' });
      var sortSelect = DM.el('select', { id: 'mkt-sort', 'aria-label': 'Sort' }, [
        DM.el('option', { value: 'newest', text: 'Newest', selected: filters.sort === 'newest' ? 'selected' : undefined }),
        DM.el('option', { value: 'price_asc', text: 'Price: low to high', selected: filters.sort === 'price_asc' ? 'selected' : undefined }),
        DM.el('option', { value: 'price_desc', text: 'Price: high to low', selected: filters.sort === 'price_desc' ? 'selected' : undefined }),
        DM.el('option', { value: 'name', text: 'Name (A-Z)', selected: filters.sort === 'name' ? 'selected' : undefined }),
      ]);

      var chipRow = DM.el('div', { class: 'chip-row' }, [
        DM.el('button', { class: 'chip ' + (filters.category === '' ? 'active' : ''), text: 'All', dataset: { value: '' } }),
      ]);
      catData.categories.forEach(function (c) {
        chipRow.appendChild(DM.el('button', { class: 'chip ' + (String(filters.category) === String(c.id) ? 'active' : ''), text: c.name, dataset: { value: String(c.id) } }));
      });
      chipRow.querySelectorAll('.chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          filters.category = chip.dataset.value;
          renderMarket();
        });
      });

      var filterBar = DM.el('div', { class: 'filter-bar' }, [
        searchInput,
        locationInput,
        minInput,
        maxInput,
        sortSelect,
      ]);

      var timer = null;
      searchInput.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          filters.q = searchInput.value.trim();
          renderMarket();
        }, 400);
      });
      locationInput.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          filters.location = locationInput.value.trim();
          renderMarket();
        }, 400);
      });
      minInput.addEventListener('input', function () {
        filters.minPrice = minInput.value.trim();
      });
      maxInput.addEventListener('input', function () {
        filters.maxPrice = maxInput.value.trim();
      });
      sortSelect.addEventListener('change', function () {
        filters.sort = sortSelect.value;
        renderMarket();
      });
      function applyPrice() {
        renderMarket();
      }
      minInput.addEventListener('change', applyPrice);
      maxInput.addEventListener('change', applyPrice);

      var grid = DM.el('div', { class: 'product-grid' });
      if (productsData.products.length === 0) {
        grid.appendChild(DM.emptyState('No products found', 'Try adjusting your search or filters.'));
      } else {
        productsData.products.forEach(function (p) {
          grid.appendChild(productCard(p));
        });
      }

      var container = DM.el('div', { class: 'page' }, [
        pageTitle('Marketplace', 'Buy fresh produce directly from farmers.'),
        DM.profileChip(DM.getStoredUser(), 'Buyer'),
        DM.el('div', { class: 'section' }, [filterBar, chipRow, DM.el('p', { class: 'result-count', text: productsData.count + ' product(s) found' }), grid]),
      ]);
      view.innerHTML = '';
      view.appendChild(container);
      refreshCartBadge();
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load marketplace', e.message));
    }
  }

  // ---------------- Product detail ----------------
  async function renderProductDetail(id) {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var [detail, compare, reviewData] = await Promise.all([
        DM.api('GET', '/api/products/' + id),
        DM.api('GET', '/api/products/' + id + '/compare'),
        DM.api('GET', '/api/products/' + id + '/reviews'),
      ]);
      var p = detail.product;
      var f = DM.freshness(p.harvestDate);

      var qtyInput = DM.el('input', { type: 'number', id: 'pd-qty', value: '1', min: '1', max: p.quantity, step: 'any' });
      var addBtn = DM.el('button', { class: 'btn-primary', text: 'Add to cart' });
      var wishBtn = wishlistBtn(p.id);
      var msgBtn = DM.el('button', { class: 'btn-ghost', text: 'Message farmer' });
      addBtn.addEventListener('click', async function () {
        var qty = Number(qtyInput.value) || 1;
        try {
          await DM.api('POST', '/api/cart', { productId: p.id, quantity: qty });
          DM.toast('Added to cart.', 'success');
          refreshCartBadge();
        } catch (e) {
          DM.toast(e.message, 'error');
        }
      });
      msgBtn.addEventListener('click', function () {
        DM.Chat.openConversation(p.farmer.id);
        DM.Chat.open();
      });

      var altRows = compare.alternatives.map(function (a) {
        var cheapest = compare.cheapest && compare.cheapest.price === a.price;
        return DM.el('tr', null, [
          DM.el('td', { text: a.farmer.name }),
          DM.el('td', { text: DM.money(a.price) + '/' + a.unit }),
          DM.el('td', { text: a.location || '-' }),
          DM.el('td', null, [
            cheapest ? DM.statusBadge('Best price', 'good') : null,
            DM.el('a', { class: 'btn-small', href: '#/buyer/product/' + a.id, text: 'View' }),
          ]),
        ]);
      });
      var altTbody = altRows.reduce(function (tb, tr) {
        tb.appendChild(tr);
        return tb;
      }, DM.el('tbody'));

      var detailGrid = DM.el('div', { class: 'product-detail' }, [
        DM.el('div', { class: 'pd-photo' }, [DM.el('img', { src: DM.productImage(p), alt: p.name })]),
        DM.el('div', { class: 'pd-info' }, [
          DM.el('h3', { text: p.name }),
          DM.statusBadge(p.category.name, 'neutral'),
          reviewData.totalCount > 0 ? DM.el('div', { class: 'pd-rating', html: starsHtml(reviewData.averageRating) + ' <span class="review-count-inline">' + reviewData.averageRating + ' (' + reviewData.totalCount + ' review' + (reviewData.totalCount !== 1 ? 's' : '') + ')</span>' }) : null,
          DM.el('p', { class: 'pd-price', text: DM.money(p.price) + ' / ' + p.unit }),
          DM.el('p', { text: p.description || 'No description provided.' }),
          DM.el('div', { class: 'info-grid' }, [
            DM.el('div', { class: 'info-item' }, [DM.el('span', { class: 'info-label', text: 'Available' }), DM.el('span', { text: p.quantity + ' ' + p.unit })]),
            DM.el('div', { class: 'info-item' }, [DM.el('span', { class: 'info-label', text: 'Harvest date' }), DM.el('span', { text: p.harvestDate || '-' })]),
            DM.el('div', { class: 'info-item' }, [DM.el('span', { class: 'info-label', text: 'Freshness' }), DM.el('span', null, [freshnessBadge(p), DM.el('span', { text: p.freshness ? ' - ' + p.freshness : '' })])]),
            DM.el('div', { class: 'info-item' }, [DM.el('span', { class: 'info-label', text: 'Farm location' }), DM.el('span', { text: p.location || '-' })]),
          ]),
          DM.el('div', { class: 'qty-row' }, [DM.el('label', { text: 'Quantity (' + p.unit + ')' }), qtyInput]),
          DM.el('div', { class: 'btn-row' }, [addBtn, wishBtn, msgBtn]),
        ]),
      ]);

      var farmerCard = DM.el('div', { class: 'farmer-card' }, [
        DM.profileImage(p.farmer, 'avatar'),
        DM.el('div', { class: 'farmer-card-meta' }, [
          DM.el('strong', { text: p.farmer.name }),
          DM.el('span', { text: p.farmer.location || 'Location not set' }),
          p.farmer.bio ? DM.el('p', { text: p.farmer.bio }) : null,
          DM.el('div', { class: 'btn-row' }, [DM.el('button', { class: 'btn-ghost btn-sm', text: 'Message farmer' })]),
        ]),
      ]);
      farmerCard.querySelector('button').addEventListener('click', function () {
        DM.Chat.openConversation(p.farmer.id);
        DM.Chat.open();
      });

      var cheapestNote = DM.el('p', { class: 'compare-note' }, [
        'Cheapest option: ',
        DM.el('strong', { text: (compare.cheapest ? compare.cheapest.farmer + ' at ' + DM.money(compare.cheapest.price) : 'this listing') }),
      ]);

      var container = DM.el('div', { class: 'page' }, [
        DM.el('a', { class: 'link', href: '#/buyer/market', text: '&larr; Back to marketplace' }),
        detailGrid,
        farmerCard,
        DM.el('div', { class: 'section' }, [
          DM.el('div', { class: 'section-head' }, [DM.el('h3', { text: 'Price comparison' })]),
          cheapestNote,
          compare.alternatives.length === 0
            ? DM.emptyState('No alternatives found', 'No other listings match this product yet.')
            : DM.el('table', { class: 'data-table' }, [
                DM.el('thead', null, [DM.el('tr', null, ['Farmer', 'Price', 'Location', ''].map(function (h) { return DM.el('th', { text: h }); }))]),
                altTbody,
              ]),
        ]),
        buildReviewsSection(p.id, reviewData),
      ]);
      view.innerHTML = '';
      view.appendChild(container);
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load product', e.message));
    }
  }

  function buildReviewsSection(productId, reviewData) {
    var dist = reviewData.distribution || [0, 0, 0, 0, 0];
    var total = reviewData.totalCount || 0;

    var distRows = [];
    for (var i = 5; i >= 1; i--) {
      var count = dist[i - 1];
      var pct = total > 0 ? Math.round((count / total) * 100) : 0;
      distRows.push(DM.el('div', { class: 'dist-row' }, [
        DM.el('span', { class: 'dist-label', text: i + ' star' }),
        DM.el('div', { class: 'dist-bar-track' }, [DM.el('div', { class: 'dist-bar-fill', style: 'width:' + pct + '%' })]),
        DM.el('span', { class: 'dist-count', text: String(count) }),
      ]));
    }

    var summaryBlock = total > 0
      ? DM.el('div', { class: 'review-summary' }, [
          DM.el('div', { class: 'review-summary-score', text: reviewData.averageRating }),
          DM.el('div', { class: 'review-summary-details' }, [
            DM.el('div', { html: starsHtml(reviewData.averageRating) }),
            DM.el('p', { class: 'pc-meta', text: total + ' review' + (total !== 1 ? 's' : '') }),
            DM.el('div', { class: 'dist-chart' }, distRows),
          ]),
        ])
      : DM.emptyState('No reviews yet', 'Be the first to review this product.');

    var reviewCards = (reviewData.reviews || []).map(function (r) {
      return DM.el('div', { class: 'review-card' }, [
        DM.el('div', { class: 'review-card-head' }, [
          DM.el('div', { class: 'review-card-meta' }, [
            DM.el('strong', { text: r.reviewerName }),
            DM.el('span', { class: 'pc-meta', text: DM.formatDate(r.createdAt) }),
          ]),
          DM.el('div', { html: starsHtml(r.rating) }),
        ]),
        DM.el('p', { class: 'review-card-body', text: r.body }),
      ]);
    });

    var reviewsList = reviewCards.length > 0
      ? DM.el('div', { class: 'reviews-list' }, reviewCards)
      : DM.emptyState('No reviews yet', 'Be the first to share your experience.');

    var reviewFormSection = buildReviewForm(productId, reviewData);

    return DM.el('div', { class: 'section' }, [
      DM.el('div', { class: 'section-head' }, [DM.el('h3', { text: 'Ratings & Reviews' })]),
      summaryBlock,
      reviewsList,
      reviewFormSection,
    ]);
  }

  function buildReviewForm(productId, reviewData) {
    var form = DM.el('div', { class: 'review-form-section', id: 'review-form-section' });
    DM.api('GET', '/api/orders/buyer').then(function (data) {
      var completedOrders = (data.orders || []).filter(function (o) {
        return o.status === 'completed' && o.items.some(function (i) { return i.product_id === productId; });
      });
      if (completedOrders.length === 0) {
        return;
      }
      var alreadyReviewed = (reviewData.reviews || []).some(function (r) {
        return r.reviewerName && r.id;
      });
      DM.api('GET', '/api/reviews/mine').then(function (mineData) {
        var hasReviewed = (mineData.reviews || []).some(function (r) { return r.productId === productId; });
        if (hasReviewed) {
          return;
        }
        var rating = 0;
        var ratingError = DM.el('div', { class: 'field-error hidden', id: 'rv-rating-error' });
        var bodyError = DM.el('div', { class: 'field-error hidden', id: 'rv-body-error' });
        var bodyInput = DM.el('textarea', { id: 'rv-body', rows: '4', maxlength: '2000', placeholder: 'Share your experience with this product...' });
        var starContainer = DM.el('div', { class: 'star-input-container', id: 'rv-stars' });
        starContainer.innerHTML = starsInputHtml('rv-rating', 0);
        starContainer.querySelectorAll('input[name="rv-rating"]').forEach(function (input) {
          input.addEventListener('change', function () {
            rating = Number(input.value);
            var stars = starContainer.querySelectorAll('.star');
            stars.forEach(function (s, idx) {
              s.classList.toggle('filled', idx < rating);
            });
            ratingError.classList.add('hidden');
          });
        });
        var submitBtn = DM.el('button', { class: 'btn-primary', text: 'Submit review' });
        var orderSelect = DM.el('select', { id: 'rv-order' });
        completedOrders.forEach(function (o) {
          orderSelect.appendChild(DM.el('option', { value: o.id, text: o.orderCode + ' (' + DM.formatDate(o.createdAt) + ')' }));
        });
        submitBtn.addEventListener('click', async function () {
          ratingError.classList.add('hidden');
          bodyError.classList.add('hidden');
          var valid = true;
          if (!rating || rating < 1 || rating > 5) {
            ratingError.textContent = 'Please select a rating from 1 to 5.';
            ratingError.classList.remove('hidden');
            valid = false;
          }
          var bodyVal = bodyInput.value.trim();
          if (!bodyVal || bodyVal.length < 5) {
            bodyError.textContent = 'Review must be at least 5 characters.';
            bodyError.classList.remove('hidden');
            valid = false;
          }
          if (!valid) return;
          submitBtn.disabled = true;
          try {
            await DM.api('POST', '/api/reviews', {
              productId: productId,
              orderId: Number(orderSelect.value),
              rating: rating,
              body: bodyVal,
            });
            DM.toast('Review submitted!', 'success');
            renderProductDetail(productId);
          } catch (e) {
            DM.toast(e.message, 'error');
            submitBtn.disabled = false;
          }
        });
        form.appendChild(DM.el('h4', { text: 'Write a Review' }));
        form.appendChild(DM.el('div', { class: 'review-form' }, [
          DM.el('div', { class: 'field' }, [DM.el('label', { text: 'Your rating' }), starContainer, ratingError]),
          DM.el('div', { class: 'field' }, [DM.el('label', { text: 'Review' }), bodyInput, bodyError]),
          DM.el('div', { class: 'field' }, [DM.el('label', { text: 'Order' }), orderSelect]),
          DM.el('div', { class: 'btn-row' }, [submitBtn]),
        ]));
      }).catch(function () {});
    }).catch(function () {});
    return form;
  }

  // ---------------- Cart ----------------
  async function renderCart() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var data = await DM.api('GET', '/api/cart');
      var container = DM.el('div', { class: 'page' }, [
        pageTitle('My Cart', 'Review items and place your order.'),
      ]);
      if (data.items.length === 0) {
        container.appendChild(DM.emptyState('Your cart is empty', 'Browse the marketplace to add products.'));
        container.appendChild(DM.el('div', { class: 'btn-row' }, [DM.el('a', { class: 'btn-primary', href: '#/buyer/market', text: 'Go to marketplace' })]));
      } else {
        var rows = data.items.map(function (item) {
          var qtyInput = DM.el('input', { type: 'number', value: item.quantity, min: '1', max: item.available, step: 'any', 'data-cartid': item.cartItemId });
          var removeBtn = DM.el('button', { class: 'btn-small btn-danger-outline', text: 'Remove' });
          qtyInput.addEventListener('change', async function () {
            try {
              await DM.api('PUT', '/api/cart/' + item.cartItemId, { quantity: Number(qtyInput.value) });
              DM.toast('Cart updated.', 'success');
              renderCart();
            } catch (e) {
              DM.toast(e.message, 'error');
              renderCart();
            }
          });
          removeBtn.addEventListener('click', async function () {
            await DM.api('DELETE', '/api/cart/' + item.cartItemId);
            DM.toast('Removed from cart.', 'success');
            renderCart();
          });
          return DM.el('tr', null, [
            DM.el('td', null, [
              DM.el('div', { class: 'product-cell' }, [
                DM.el('img', { class: 'thumb', src: DM.productImage(item), alt: item.productName }),
                DM.el('span', { class: 'td-strong', text: item.productName }),
              ]),
            ]),
            DM.el('td', { text: item.farmer.name }),
            DM.el('td', { text: DM.money(item.price) + '/' + item.unit }),
            DM.el('td', null, [qtyInput]),
            DM.el('td', { text: DM.money(item.subtotal) }),
            DM.el('td', null, [removeBtn]),
          ]);
        });
        var tbody = rows.reduce(function (tb, tr) {
          tb.appendChild(tr);
          return tb;
        }, DM.el('tbody'));

        var checkoutBtn = DM.el('button', { class: 'btn-primary', text: 'Proceed to checkout - ' + DM.money(data.total) });
        checkoutBtn.addEventListener('click', function () {
          openCheckout(data.total, data.items);
        });

        container.appendChild(
          DM.el('div', { class: 'section' }, [
            DM.el('table', { class: 'data-table' }, [
              DM.el('thead', null, [DM.el('tr', null, ['Product', 'Farmer', 'Price', 'Qty', 'Subtotal', ''].map(function (h) { return DM.el('th', { text: h }); }))]),
              tbody,
            ]),
            DM.el('div', { class: 'checkout-bar' }, [
              DM.el('div', { class: 'cart-total', text: 'Total: ' + DM.money(data.total) }),
              checkoutBtn,
            ]),
          ])
        );
      }
      view.innerHTML = '';
      view.appendChild(container);
      refreshCartBadge();
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load cart', e.message));
    }
  }

  function openCheckout(total, items) {
    items = items || [];
    var summaryRows = items.map(function (item) {
      return DM.el('tr', null, [
        DM.el('td', { class: 'td-strong', text: item.productName }),
        DM.el('td', { class: 'ta-r', text: item.quantity + ' x ' + DM.money(item.price) }),
        DM.el('td', { class: 'ta-r', text: DM.money(item.subtotal) }),
      ]);
    });
    var summaryTbody = summaryRows.reduce(function (tb, tr) {
      tb.appendChild(tr);
      return tb;
    }, DM.el('tbody'));
    var summaryTable = DM.el('table', { class: 'data-table co-summary' }, [
      DM.el('thead', null, [DM.el('tr', null, ['Product', 'Qty x Price', 'Subtotal'].map(function (h) { return DM.el('th', { text: h }); }))]),
      summaryTbody,
      DM.el('tfoot', null, [DM.el('tr', null, [DM.el('td', { colspan: '2', class: 'ta-r', text: 'Total' }), DM.el('td', { class: 'ta-r co-total', text: DM.money(total) })])]),
    ]);

    var addressInput = DM.el('textarea', { id: 'co-address', rows: '2', maxlength: '300', placeholder: 'Delivery address, e.g. Namugongo, Kampala', required: 'required' });
    var methodCard = DM.el('input', { type: 'radio', name: 'co-method', value: 'card', id: 'co-card', checked: 'checked' });
    var methodMobile = DM.el('input', { type: 'radio', name: 'co-method', value: 'mobile_money', id: 'co-mobile' });
    var cardDetails = DM.el('div', { id: 'co-card-details', class: 'form-grid' }, [
      DM.field('Name on card', DM.el('input', { type: 'text', id: 'co-card-name', placeholder: 'JOHN OKELLO' })),
      DM.field('Card number', DM.el('input', { type: 'text', id: 'co-card-number', placeholder: '4242 4242 4242 4242', maxlength: '19' })),
      DM.field('Expiry (MM/YY)', DM.el('input', { type: 'text', id: 'co-card-expiry', placeholder: '12/30', maxlength: '5' })),
    ]);
    var mobileDetails = DM.el('div', { id: 'co-mobile-details', class: 'hidden form-grid' }, [
      DM.field('Mobile money number', DM.el('input', { type: 'text', id: 'co-mobile-number', placeholder: '+256 7xx xxx xxx' })),
    ]);

    methodCard.addEventListener('change', function () {
      cardDetails.classList.remove('hidden');
      mobileDetails.classList.add('hidden');
    });
    methodMobile.addEventListener('change', function () {
      cardDetails.classList.add('hidden');
      mobileDetails.classList.remove('hidden');
    });

    var body = DM.el('div', { class: 'checkout-form' }, [
      DM.el('h4', { class: 'co-title', text: 'Order summary' }),
      summaryTable,
      DM.el('p', { class: 'checkout-total', text: 'Order total: ' + DM.money(total) }),
      DM.field('Delivery address', addressInput),
      DM.el('div', { class: 'field' }, [
        DM.el('label', { text: 'Payment method' }),
        DM.el('label', { class: 'pay-option' }, [methodCard, DM.el('span', { text: 'Card (demo)' })]),
        DM.el('label', { class: 'pay-option' }, [methodMobile, DM.el('span', { text: 'Mobile money (demo)' })]),
      ]),
      cardDetails,
      mobileDetails,
      DM.el('p', { class: 'field-hint', html: '<strong>Mock payment gateway.</strong> No real money is charged. Use demo card 4242 4242 4242 4242, any MM/YY expiry.' }),
    ]);

    var payBtn = DM.el('button', { class: 'btn-primary', text: 'Place order &amp; pay' });
    var cancelBtn = DM.el('button', { class: 'btn-ghost', text: 'Cancel' });
    var foot = DM.el('div', { class: 'btn-row' }, [cancelBtn, payBtn]);
    var modal = DM.openModal(body, { title: 'Checkout', footer: foot, size: 'lg' });
    payBtn.addEventListener('click', async function () {
      var address = addressInput.value.trim();
      if (!address) {
        DM.toast('Please enter a delivery address.', 'error');
        return;
      }
      payBtn.disabled = true;
      try {
        var placed = await DM.api('POST', '/api/orders', { deliveryAddress: address });
        var method = document.querySelector('input[name="co-method"]:checked').value;
        var details = {};
        if (method === 'card') {
          details = {
            name: document.getElementById('co-card-name').value.trim(),
            number: document.getElementById('co-card-number').value.trim(),
            expiry: document.getElementById('co-card-expiry').value.trim(),
          };
        } else {
          details = { phone: document.getElementById('co-mobile-number').value.trim() };
        }
        var paid = [];
        for (var i = 0; i < placed.orders.length; i++) {
          var pay = await DM.api('POST', '/api/payments/' + placed.orders[i].id, { method: method, details: details });
          paid.push(pay);
        }
        modal.close();
        DM.toast(paid.length + ' order(s) paid (mock gateway).', 'success');
        refreshCartBadge();
        window.location.hash = '#/buyer/orders';
      } catch (e) {
        DM.toast(e.message, 'error');
        payBtn.disabled = false;
        renderCart();
      }
    });
    cancelBtn.addEventListener('click', modal.close);
  }

  // ---------------- Orders ----------------
  async function renderOrders() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var data = await DM.api('GET', '/api/orders/buyer');
      var container = DM.el('div', { class: 'page' }, [
        pageTitle('My Orders', 'Track payments, delivery and order history.'),
      ]);
      if (data.orders.length === 0) {
        container.appendChild(DM.emptyState('No orders yet', 'When you place orders, they will appear here.'));
      } else {
        var cards = data.orders.map(function (o) {
          var statusMap = { placed: 'warn', accepted: 'good', rejected: 'bad', completed: 'good', cancelled: 'neutral' };
          var payMap = { pending: 'warn', paid: 'good', refunded: 'neutral', failed: 'bad' };
          var orderCard = DM.el('div', { class: 'order-card' }, [
            DM.el('div', { class: 'order-card-head' }, [
              DM.el('div', null, [
                DM.el('strong', { text: o.orderCode }),
                DM.el('div', { class: 'order-meta', text: 'Placed ' + DM.formatDate(o.createdAt) + ' - ' + o.farmer.name }),
              ]),
              DM.el('div', { class: 'order-badges' }, [DM.statusBadge(o.status, statusMap[o.status]), DM.statusBadge('Payment: ' + o.paymentStatus, payMap[o.paymentStatus])]),
            ]),
            DM.el('div', { class: 'order-items' }, o.items.map(function (i) {
              return DM.el('div', { class: 'order-item' }, [
                DM.el('span', { text: i.product_name + ' x' + i.quantity }),
                DM.el('span', { text: DM.money(i.subtotal) }),
              ]);
            })),
            DM.el('div', { class: 'order-foot' }, [
              DM.el('span', { class: 'order-total', text: 'Total: ' + DM.money(o.total) }),
              DM.el('div', { class: 'btn-row' }, []),
            ]),
          ]);
          var actions = orderCard.querySelector('.btn-row');
          if (o.paymentStatus === 'pending' && o.status === 'placed') {
            var payBtn = DM.el('button', { class: 'btn-primary btn-sm', text: 'Pay now' });
            payBtn.addEventListener('click', function () {
              openPaymentModal(o.id, o.total);
            });
            actions.appendChild(payBtn);
          }
          if (o.status === 'placed' && o.paymentStatus !== 'paid') {
            var cancelBtn = DM.el('button', { class: 'btn-ghost btn-sm', text: 'Cancel' });
            cancelBtn.addEventListener('click', async function () {
              await DM.api('PATCH', '/api/orders/' + o.id, { action: 'cancel' });
              DM.toast('Order cancelled.', 'success');
              renderOrders();
            });
            actions.appendChild(cancelBtn);
          }
          if (o.delivery) {
            var trackBtn = DM.el('button', { class: 'btn-ghost btn-sm', text: 'Track delivery' });
            trackBtn.addEventListener('click', function () {
              renderDelivery(o.id);
            });
            actions.appendChild(trackBtn);
          }
          return orderCard;
        });
        cards.forEach(function (c) {
          container.appendChild(c);
        });
      }
      view.innerHTML = '';
      view.appendChild(container);
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load orders', e.message));
    }
  }

  function openPaymentModal(orderId, total) {
    var methodCard = DM.el('input', { type: 'radio', name: 'pm-method', value: 'card', id: 'pm-card', checked: 'checked' });
    var methodMobile = DM.el('input', { type: 'radio', name: 'pm-method', value: 'mobile_money', id: 'pm-mobile' });
    var cardDetails = DM.el('div', { id: 'pm-card-details', class: 'form-grid' }, [
      DM.field('Name on card', DM.el('input', { type: 'text', id: 'pm-card-name' })),
      DM.field('Card number', DM.el('input', { type: 'text', id: 'pm-card-number', placeholder: '4242 4242 4242 4242', maxlength: '19' })),
      DM.field('Expiry (MM/YY)', DM.el('input', { type: 'text', id: 'pm-card-expiry', placeholder: '12/30', maxlength: '5' })),
    ]);
    var mobileDetails = DM.el('div', { id: 'pm-mobile-details', class: 'hidden form-grid' }, [
      DM.field('Mobile money number', DM.el('input', { type: 'text', id: 'pm-mobile-number', placeholder: '+256 7xx xxx xxx' })),
    ]);
    methodCard.addEventListener('change', function () {
      cardDetails.classList.remove('hidden');
      mobileDetails.classList.add('hidden');
    });
    methodMobile.addEventListener('change', function () {
      cardDetails.classList.add('hidden');
      mobileDetails.classList.remove('hidden');
    });

    var body = DM.el('div', { class: 'checkout-form' }, [
      DM.el('p', { class: 'checkout-total', text: 'Amount due: ' + DM.money(total) }),
      DM.el('label', { class: 'pay-option' }, [methodCard, DM.el('span', { text: 'Card (demo)' })]),
      DM.el('label', { class: 'pay-option' }, [methodMobile, DM.el('span', { text: 'Mobile money (demo)' })]),
      cardDetails,
      mobileDetails,
      DM.el('p', { class: 'field-hint', html: '<strong>Mock payment gateway.</strong> No real money is charged.' }),
    ]);
    var payBtn = DM.el('button', { class: 'btn-primary', text: 'Pay ' + DM.money(total) });
    var cancelBtn = DM.el('button', { class: 'btn-ghost', text: 'Cancel' });
    var modal = DM.openModal(body, { title: 'Complete payment', footer: DM.el('div', { class: 'btn-row' }, [cancelBtn, payBtn]) });
    payBtn.addEventListener('click', async function () {
      payBtn.disabled = true;
      var method = document.querySelector('input[name="pm-method"]:checked').value;
      var details = method === 'card'
        ? { name: document.getElementById('pm-card-name').value.trim(), number: document.getElementById('pm-card-number').value.trim(), expiry: document.getElementById('pm-card-expiry').value.trim() }
        : { phone: document.getElementById('pm-mobile-number').value.trim() };
      try {
        await DM.api('POST', '/api/payments/' + orderId, { method: method, details: details });
        modal.close();
        DM.toast('Payment successful (mock gateway).', 'success');
        renderOrders();
      } catch (e) {
        DM.toast(e.message, 'error');
        payBtn.disabled = false;
      }
    });
    cancelBtn.addEventListener('click', modal.close);
  }

  // ---------------- Delivery tracking ----------------
  async function renderDelivery(orderId) {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var data = await DM.api('GET', '/api/deliveries/' + orderId);
      var d = data.delivery;
      var steps = ['processing', 'in_transit', 'out_for_delivery', 'delivered'];
      var currentIdx = steps.indexOf(d.status);
      var labels = {
        processing: 'Processing',
        in_transit: 'In transit',
        out_for_delivery: 'Out for delivery',
        delivered: 'Delivered',
      };
      var timeline = steps.map(function (step, i) {
        var state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'todo';
        return DM.el('li', { class: 'tl-step ' + state }, [
          DM.el('span', { class: 'tl-dot' }),
          DM.el('div', null, [
            DM.el('strong', { text: labels[step] }),
            i < currentIdx ? DM.el('div', { class: 'tl-time', text: 'Completed' }) : null,
          ]),
        ]);
      });

      var historyRows = d.history.map(function (h) {
        return DM.el('tr', null, [
          DM.el('td', { text: new Date(h.at).toLocaleString() }),
          DM.el('td', { text: h.status.replace(/_/g, ' ').toUpperCase() }),
          DM.el('td', { text: h.text }),
        ]);
      });
      var histTbody = historyRows.reduce(function (tb, tr) {
        tb.appendChild(tr);
        return tb;
      }, DM.el('tbody'));

      var simulateBtn = DM.el('button', { class: 'btn-primary', text: 'Simulate next tracking update (demo)' });
      simulateBtn.addEventListener('click', async function () {
        try {
          await DM.api('POST', '/api/deliveries/' + orderId + '/advance');
          DM.toast('Delivery status advanced (demo).', 'success');
          renderDelivery(orderId);
        } catch (e) {
          DM.toast(e.message, 'error');
        }
      });

      var container = DM.el('div', { class: 'page' }, [
        DM.el('a', { class: 'link', href: '#/buyer/orders', text: '&larr; Back to orders' }),
        pageTitle('Delivery tracking', 'Follow your order from farm to door.'),
        DM.el('div', { class: 'section' }, [
          DM.el('div', { class: 'tracking-head' }, [
            DM.el('div', null, [
              DM.el('strong', { text: d.trackingCode }),
              DM.el('div', { text: d.carrier + ' - ' + d.currentLocation }),
            ]),
            DM.statusBadge(d.status.replace(/_/g, ' '), 'good'),
          ]),
          DM.el('p', { class: 'field-hint', text: 'Estimated delivery: ' + (d.estimatedDelivery ? DM.formatDate(d.estimatedDelivery) : 'n/a') + '  |  This is a demo tracking simulation.' }),
          DM.el('ul', { class: 'timeline' }, timeline),
          DM.el('div', { class: 'btn-row' }, [simulateBtn]),
        ]),
        DM.el('div', { class: 'section' }, [
          DM.el('h3', { text: 'Tracking history' }),
          DM.el('table', { class: 'data-table' }, [
            DM.el('thead', null, [DM.el('tr', null, ['Time', 'Status', 'Details'].map(function (h) { return DM.el('th', { text: h }); }))]),
            histTbody,
          ]),
        ]),
      ]);
      view.innerHTML = '';
      view.appendChild(container);
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load delivery', e.message));
    }
  }

  // ---------------- Wishlist ----------------
  async function renderWishlist() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var data = await DM.api('GET', '/api/wishlist');
      var container = DM.el('div', { class: 'page' }, [
        pageTitle('My Wishlist', 'Products you\'ve saved for later.'),
      ]);
      if (data.items.length === 0) {
        container.appendChild(DM.emptyState('Your wishlist is empty', 'Browse the marketplace and save products you like.'));
        container.appendChild(DM.el('div', { class: 'btn-row' }, [DM.el('a', { class: 'btn-primary', href: '#/buyer/market', text: 'Go to marketplace' })]));
      } else {
        var grid = DM.el('div', { class: 'product-grid' });
        data.items.forEach(function (item) {
          var removeBtn = DM.el('button', { class: 'btn-ghost btn-sm', text: 'Remove' });
          removeBtn.addEventListener('click', async function () {
            try {
              await DM.api('DELETE', '/api/wishlist/' + item.productId);
              DM.toast('Removed from wishlist.', 'success');
              renderWishlist();
            } catch (e) {
              DM.toast(e.message, 'error');
            }
          });
          var addCartBtn = DM.el('button', { class: 'btn-primary btn-sm', text: 'Add to cart' });
          addCartBtn.addEventListener('click', async function () {
            try {
              await DM.api('POST', '/api/cart', { productId: item.productId, quantity: 1 });
              DM.toast('Added to cart.', 'success');
              refreshCartBadge();
            } catch (e) {
              DM.toast(e.message, 'error');
            }
          });
          var card = DM.el('div', { class: 'product-card' }, [
            DM.el('div', { class: 'product-card-img' }, [
              DM.el('img', { src: DM.productImage(item), alt: item.productName, loading: 'lazy' }),
            ]),
            DM.el('div', { class: 'product-card-body' }, [
              DM.el('h4', { text: item.productName }),
              DM.el('p', { class: 'pc-price', text: DM.money(item.price) + ' / ' + item.unit }),
              DM.el('p', { class: 'pc-meta', html: '<strong>' + DM.esc(item.farmer.name) + '</strong>' + (item.farmer.location ? ' - ' + DM.esc(item.farmer.location) : '') }),
              DM.el('p', { class: 'pc-meta', text: item.available > 0 ? 'In stock: ' + item.available + ' ' + item.unit : 'Out of stock' }),
              DM.el('div', { class: 'btn-row' }, [
                DM.el('a', { class: 'btn-ghost btn-sm', href: '#/buyer/product/' + item.productId, text: 'View' }),
                addCartBtn,
                removeBtn,
              ]),
            ]),
          ]);
          if (!item.available || item.available <= 0) {
            addCartBtn.disabled = true;
          }
          grid.appendChild(card);
        });
        container.appendChild(DM.el('div', { class: 'section' }, [grid]));
      }
      view.innerHTML = '';
      view.appendChild(container);
      refreshCartBadge();
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load wishlist', e.message));
    }
  }

  // ---------------- My Reviews ----------------
  async function renderMyReviews() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    try {
      var data = await DM.api('GET', '/api/reviews/mine');
      var container = DM.el('div', { class: 'page' }, [
        pageTitle('My Reviews', 'Reviews you have submitted for purchased products.'),
      ]);
      if (data.reviews.length === 0) {
        container.appendChild(DM.emptyState('No reviews yet', 'Complete a purchase and share your experience.'));
        container.appendChild(DM.el('div', { class: 'btn-row' }, [DM.el('a', { class: 'btn-primary', href: '#/buyer/market', text: 'Go to marketplace' })]));
      } else {
        var list = DM.el('div', { class: 'reviews-list' });
        data.reviews.forEach(function (r) {
          var removeBtn = DM.el('button', { class: 'btn-ghost btn-sm', text: 'Delete' });
          removeBtn.addEventListener('click', async function () {
            if (!confirm('Delete this review?')) return;
            try {
              await DM.api('DELETE', '/api/reviews/' + r.id);
              DM.toast('Review deleted.', 'success');
              renderMyReviews();
            } catch (e) {
              DM.toast(e.message, 'error');
            }
          });
          list.appendChild(DM.el('div', { class: 'review-card' }, [
            DM.el('div', { class: 'review-card-head' }, [
              DM.el('div', { class: 'review-card-meta' }, [
                DM.el('a', { class: 'review-product-link', href: '#/buyer/product/' + r.productId, text: r.productName }),
                DM.el('span', { class: 'pc-meta', text: DM.formatDate(r.createdAt) }),
              ]),
              DM.el('div', null, [DM.el('div', { html: starsHtml(r.rating) }), removeBtn]),
            ]),
            DM.el('p', { class: 'review-card-body', text: r.body }),
          ]));
        });
        container.appendChild(DM.el('div', { class: 'section' }, [list]));
      }
      view.innerHTML = '';
      view.appendChild(container);
    } catch (e) {
      DM.toast(e.message, 'error');
      view.appendChild(DM.emptyState('Could not load reviews', e.message));
    }
  }

  // ---------------- Farmers / location search ----------------
  async function renderFarmers() {
    DM.setView(DM.skeleton());
    var view = document.getElementById('view');
    var searchInput = DM.el('input', { type: 'search', id: 'farmer-q', placeholder: 'Search farmers by location or name...' });
    var timer = null;
    var grid = DM.el('div', { class: 'farmer-grid' });

    async function load(q) {
      grid.innerHTML = '';
      grid.appendChild(DM.el('div', { class: 'loading', text: 'Loading...' }));
      try {
        var data = await DM.api('GET', '/api/farmers' + (q ? '?q=' + encodeURIComponent(q) : ''));
        grid.innerHTML = '';
        if (data.farmers.length === 0) {
          grid.appendChild(DM.emptyState('No farmers found', 'Try a different location or name.'));
        } else {
          data.farmers.forEach(function (f) {
            var card = DM.el('div', { class: 'farmer-card' }, [
              DM.profileImage(f, 'avatar'),
              DM.el('div', { class: 'farmer-card-meta' }, [
                DM.el('strong', { text: f.name }),
                DM.el('span', { text: f.location || 'Location not set' }),
                DM.el('span', { text: f.product_count + ' active product(s)' }),
                DM.el('div', { class: 'btn-row' }, [DM.el('button', { class: 'btn-ghost btn-sm', text: 'Message' })]),
              ]),
            ]);
            card.querySelector('button').addEventListener('click', function () {
              DM.Chat.openConversation(f.id);
              DM.Chat.open();
            });
            grid.appendChild(card);
          });
        }
      } catch (e) {
        DM.toast(e.message, 'error');
      }
    }

    searchInput.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        load(searchInput.value.trim());
      }, 400);
    });

    var container = DM.el('div', { class: 'page' }, [
      pageTitle('Find Farmers', 'Search farmers by location to buy nearby produce.'),
      DM.el('div', { class: 'section' }, [searchInput, DM.el('p', { class: 'result-count', text: 'Enter a location to filter farmers.' }), grid]),
    ]);
    view.innerHTML = '';
    view.appendChild(container);
    load('');
  }

  DM.Views = DM.Views || {};
  DM.Views.buyer = {
    '/market': renderMarket,
    '/product/:id': function (params) {
      return renderProductDetail(params.id);
    },
    '/cart': renderCart,
    '/wishlist': renderWishlist,
    '/orders': renderOrders,
    '/reviews': renderMyReviews,
    '/delivery/:id': function (params) {
      return renderDelivery(params.id);
    },
    '/farmers': renderFarmers,
  };
  DM.Buyer = { refreshCartBadge: refreshCartBadge };
})();
