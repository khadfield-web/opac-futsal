/* ============================================================
   OPAC Futsal — sortable
   Pointer-based drag reordering that works with a mouse, a
   trackpad, and a finger on a school iPad. Items can be dragged
   within a list and across lists (i.e. between weeks).
   ============================================================ */
(function (global) {
  'use strict';

  function makeSortable(opts) {
    var root = opts.root;
    var listSel = opts.list;
    var itemSel = opts.item;
    var handleSel = opts.handle;
    var onDrop = opts.onDrop || function () {};

    var drag = null;
    var scrollRAF = null;
    var scrollDir = 0;

    function lists() {
      return Array.prototype.slice.call(root.querySelectorAll(listSel));
    }

    function itemsIn(list) {
      return Array.prototype.slice.call(list.children).filter(function (c) {
        return c.matches && c.matches(itemSel);
      });
    }

    function indexOfPlaceholder(list, ph) {
      var n = 0;
      for (var i = 0; i < list.children.length; i++) {
        var c = list.children[i];
        if (c === ph) return n;
        if (c.matches && c.matches(itemSel)) n++;
      }
      return n;
    }

    function autoScroll() {
      if (!drag) { scrollRAF = null; return; }
      if (scrollDir) global.scrollBy(0, scrollDir * 14);
      scrollRAF = requestAnimationFrame(autoScroll);
    }

    function start(e) {
      var handle = e.target.closest(handleSel);
      if (!handle || !root.contains(handle)) return;
      if (e.button !== undefined && e.button !== 0) return;

      var item = handle.closest(itemSel);
      if (!item) return;

      var fromList = item.closest(listSel);
      if (!fromList) return;

      e.preventDefault();

      var rect = item.getBoundingClientRect();
      var ph = document.createElement('div');
      ph.className = 'drop-placeholder';
      ph.style.height = rect.height + 'px';

      drag = {
        item: item,
        ph: ph,
        fromList: fromList,
        fromIndex: itemsIn(fromList).indexOf(item),
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        width: rect.width,
        pointerId: e.pointerId
      };

      fromList.insertBefore(ph, item);

      item.classList.add('dragging');
      item.style.width = rect.width + 'px';
      item.style.position = 'fixed';
      item.style.left = rect.left + 'px';
      item.style.top = rect.top + 'px';
      item.style.zIndex = '400';
      item.style.pointerEvents = 'none';
      item.style.margin = '0';
      document.body.appendChild(item);
      document.body.classList.add('is-dragging');

      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);

      scrollRAF = requestAnimationFrame(autoScroll);
    }

    function move(e) {
      if (!drag) return;
      e.preventDefault();

      drag.item.style.left = (e.clientX - drag.offsetX) + 'px';
      drag.item.style.top = (e.clientY - drag.offsetY) + 'px';

      var margin = 90;
      if (e.clientY < margin) scrollDir = -1;
      else if (e.clientY > global.innerHeight - margin) scrollDir = 1;
      else scrollDir = 0;

      var under = document.elementFromPoint(e.clientX, e.clientY);
      if (!under) return;

      var overItem = under.closest ? under.closest(itemSel) : null;
      if (overItem && overItem !== drag.item && root.contains(overItem)) {
        var r = overItem.getBoundingClientRect();
        var after = e.clientY > r.top + r.height / 2;
        var parent = overItem.parentNode;
        if (after) parent.insertBefore(drag.ph, overItem.nextSibling);
        else parent.insertBefore(drag.ph, overItem);
        return;
      }

      var overList = under.closest ? under.closest(listSel) : null;
      if (overList && root.contains(overList) && !overList.contains(drag.ph)) {
        overList.appendChild(drag.ph);
      }
    }

    function end(e) {
      if (!drag) return;
      var d = drag;
      drag = null;
      scrollDir = 0;
      if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }

      var handle = e.currentTarget;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      try { handle.releasePointerCapture(d.pointerId); } catch (err) {}

      var toList = d.ph.parentNode;
      var toIndex = indexOfPlaceholder(toList, d.ph);

      /* restore the node before handing control back */
      d.item.classList.remove('dragging');
      d.item.removeAttribute('style');
      d.ph.parentNode.insertBefore(d.item, d.ph);
      d.ph.remove();
      document.body.classList.remove('is-dragging');

      var sameList = toList === d.fromList;
      if (sameList && toIndex === d.fromIndex) return;

      onDrop({
        fromList: d.fromList,
        fromIndex: d.fromIndex,
        toList: toList,
        toIndex: toIndex,
        item: d.item
      });
    }

    root.addEventListener('pointerdown', start);

    return {
      destroy: function () { root.removeEventListener('pointerdown', start); }
    };
  }

  global.makeSortable = makeSortable;
})(window);
