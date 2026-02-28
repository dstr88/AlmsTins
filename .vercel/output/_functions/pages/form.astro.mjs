import { c as createComponent, r as renderComponent, a as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_BjWguqo6.mjs';
import 'kleur/colors';
import { $ as $$Layout } from '../chunks/Layout_DRU0i8Z_.mjs';
/* empty css                                */
export { renderers } from '../renderers.mjs';

var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(raw || cooked.slice()) }));
var _a;
const $$Form = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "Layout", $$Layout, { "data-astro-cid-xb3inwvi": true }, { "default": ($$result2) => renderTemplate(_a || (_a = __template([" ", `<main class="wrap" data-astro-cid-xb3inwvi> <h1 data-astro-cid-xb3inwvi>Get in touch</h1> <form method="POST" class="lead-form" autocomplete="on" novalidate data-astro-cid-xb3inwvi> <div class="grid" data-astro-cid-xb3inwvi> <div class="field" data-astro-cid-xb3inwvi> <label for="name" data-astro-cid-xb3inwvi>Full name</label> <input id="name" name="name" type="text" required autocomplete="name" placeholder="Jane Doe" data-astro-cid-xb3inwvi> </div> <div class="field" data-astro-cid-xb3inwvi> <label for="email" data-astro-cid-xb3inwvi>Email</label> <input id="email" name="email" type="email" required inputmode="email" autocomplete="email" placeholder="you@example.com" data-astro-cid-xb3inwvi> </div> <div class="field" data-astro-cid-xb3inwvi> <label for="phone" data-astro-cid-xb3inwvi>Phone (optional)</label> <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(555) 555-5555" data-astro-cid-xb3inwvi> </div> <div class="field" data-astro-cid-xb3inwvi> <label for="city" data-astro-cid-xb3inwvi>City (optional)</label> <input id="city" name="city" type="text" autocomplete="address-level2" placeholder="Nashville" data-astro-cid-xb3inwvi> </div> <div class="field" data-astro-cid-xb3inwvi> <label for="state" data-astro-cid-xb3inwvi>State (optional)</label> <input id="state" name="state" type="text" autocomplete="address-level1" placeholder="TN" data-astro-cid-xb3inwvi> </div> <!-- Radios: Do you currently have a website? --> <fieldset class="field field--full" data-astro-cid-xb3inwvi> <legend data-astro-cid-xb3inwvi>Do you currently have a website?</legend> <label class="radio" data-astro-cid-xb3inwvi> <input type="radio" name="hasWebsite" value="no" checked data-astro-cid-xb3inwvi> <span data-astro-cid-xb3inwvi>No</span> </label> <label class="radio" data-astro-cid-xb3inwvi> <input type="radio" name="hasWebsite" value="yes" data-astro-cid-xb3inwvi> <span data-astro-cid-xb3inwvi>Yes</span> </label> </fieldset> <!-- Websites block (hidden unless "Yes") --> <div class="field field--full websites-block" hidden data-astro-cid-xb3inwvi> <label data-astro-cid-xb3inwvi>Website address(es) <small data-astro-cid-xb3inwvi>(up to 3)</small></label> <div id="websites-list" class="websites-list" data-astro-cid-xb3inwvi></div> <button class="btn btn-add" type="button" id="add-website" aria-label="Add another website" data-astro-cid-xb3inwvi>+</button> </div> <div class="field field--full" data-astro-cid-xb3inwvi> <label for="comments" data-astro-cid-xb3inwvi>Comments (optional)</label> <textarea id="comments" name="comments" rows="4" placeholder="Tell us what you need\u2026" data-astro-cid-xb3inwvi></textarea> </div> <div class="actions" data-astro-cid-xb3inwvi> <button type="submit" class="btn" data-astro-cid-xb3inwvi>Send</button> </div> </div> <!-- Honeypot anti-spam (hidden) --> <input type="text" name="_hp" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true" data-astro-cid-xb3inwvi> </form> </main> <script>
    const qs  = (sel) => document.querySelector(sel);
    const qsa = (sel) => Array.from(document.querySelectorAll(sel));

    const formEl        = qs('form.lead-form');
    const radios        = qsa('input[name="hasWebsite"]');
    const websitesBlock = qs('.websites-block');
    const list          = document.getElementById('websites-list');
    const addBtn        = document.getElementById('add-website');
    const MAX = 3;

    if (formEl && websitesBlock && list && addBtn) {
      function makeWebsiteRow(initialValue = '') {
        const row = document.createElement('div');
        row.className = 'website-row';
        row.innerHTML = \`
          <input
            type="url"
            name="websites"
            inputmode="url"
            placeholder="https://example.com"
            value="\${initialValue.replace(/"/g,'&quot;')}"
            aria-label="Website URL"
            required
          />
          <button type="button" class="btn btn-remove" aria-label="Remove this website">\u2013</button>
        \`;
        row.querySelector('.btn-remove')?.addEventListener('click', () => {
          row.remove();
          updateAddButton();
          toggleRequired();
        });
        return row;
      }

      function updateAddButton() {
        const count = list.querySelectorAll('input[name="websites"]').length;
        addBtn.disabled = count >= MAX;
      }

      function toggleRequired() {
        const inputs = list.querySelectorAll('input[name="websites"]');
        inputs.forEach((inp, i) => { inp.required = (i === 0 && !websitesBlock.hidden); });
      }

      function showWebsitesBlock(show) {
        websitesBlock.hidden = !show;
        if (show && list.children.length === 0) list.appendChild(makeWebsiteRow());
        if (!show) list.innerHTML = '';
        updateAddButton();
        toggleRequired();
      }

      radios.forEach((r) => r.addEventListener('change', () => showWebsitesBlock(r.value === 'yes')));
      addBtn.addEventListener('click', () => {
        if (list.querySelectorAll('input[name="websites"]').length < MAX) {
          list.appendChild(makeWebsiteRow());
          updateAddButton();
          toggleRequired();
        }
      });

      // initial
      showWebsitesBlock(radios.find((r) => r.checked)?.value === 'yes');

      // Serialize all website inputs into a single hidden JSON field.
      const hiddenWebsites = document.createElement('input');
      hiddenWebsites.type = 'hidden';
      hiddenWebsites.name = 'websitesJson';
      formEl.appendChild(hiddenWebsites);

      formEl.addEventListener('submit', () => {
        const vals = qsa('input[name="websites"]')
          .map((i) => i.value.trim())
          .filter(Boolean)
          .slice(0, 3);
        hiddenWebsites.value = JSON.stringify(vals);

        // Avoid duplicate keys: remove 'name' from visible inputs
        qsa('input[name="websites"]').forEach((i) => i.removeAttribute('name'));
      });
    } else {
      console.warn('[lead-form] required elements not found; skipping script');
    }
  <\/script>  `], [" ", `<main class="wrap" data-astro-cid-xb3inwvi> <h1 data-astro-cid-xb3inwvi>Get in touch</h1> <form method="POST" class="lead-form" autocomplete="on" novalidate data-astro-cid-xb3inwvi> <div class="grid" data-astro-cid-xb3inwvi> <div class="field" data-astro-cid-xb3inwvi> <label for="name" data-astro-cid-xb3inwvi>Full name</label> <input id="name" name="name" type="text" required autocomplete="name" placeholder="Jane Doe" data-astro-cid-xb3inwvi> </div> <div class="field" data-astro-cid-xb3inwvi> <label for="email" data-astro-cid-xb3inwvi>Email</label> <input id="email" name="email" type="email" required inputmode="email" autocomplete="email" placeholder="you@example.com" data-astro-cid-xb3inwvi> </div> <div class="field" data-astro-cid-xb3inwvi> <label for="phone" data-astro-cid-xb3inwvi>Phone (optional)</label> <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(555) 555-5555" data-astro-cid-xb3inwvi> </div> <div class="field" data-astro-cid-xb3inwvi> <label for="city" data-astro-cid-xb3inwvi>City (optional)</label> <input id="city" name="city" type="text" autocomplete="address-level2" placeholder="Nashville" data-astro-cid-xb3inwvi> </div> <div class="field" data-astro-cid-xb3inwvi> <label for="state" data-astro-cid-xb3inwvi>State (optional)</label> <input id="state" name="state" type="text" autocomplete="address-level1" placeholder="TN" data-astro-cid-xb3inwvi> </div> <!-- Radios: Do you currently have a website? --> <fieldset class="field field--full" data-astro-cid-xb3inwvi> <legend data-astro-cid-xb3inwvi>Do you currently have a website?</legend> <label class="radio" data-astro-cid-xb3inwvi> <input type="radio" name="hasWebsite" value="no" checked data-astro-cid-xb3inwvi> <span data-astro-cid-xb3inwvi>No</span> </label> <label class="radio" data-astro-cid-xb3inwvi> <input type="radio" name="hasWebsite" value="yes" data-astro-cid-xb3inwvi> <span data-astro-cid-xb3inwvi>Yes</span> </label> </fieldset> <!-- Websites block (hidden unless "Yes") --> <div class="field field--full websites-block" hidden data-astro-cid-xb3inwvi> <label data-astro-cid-xb3inwvi>Website address(es) <small data-astro-cid-xb3inwvi>(up to 3)</small></label> <div id="websites-list" class="websites-list" data-astro-cid-xb3inwvi></div> <button class="btn btn-add" type="button" id="add-website" aria-label="Add another website" data-astro-cid-xb3inwvi>+</button> </div> <div class="field field--full" data-astro-cid-xb3inwvi> <label for="comments" data-astro-cid-xb3inwvi>Comments (optional)</label> <textarea id="comments" name="comments" rows="4" placeholder="Tell us what you need\u2026" data-astro-cid-xb3inwvi></textarea> </div> <div class="actions" data-astro-cid-xb3inwvi> <button type="submit" class="btn" data-astro-cid-xb3inwvi>Send</button> </div> </div> <!-- Honeypot anti-spam (hidden) --> <input type="text" name="_hp" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true" data-astro-cid-xb3inwvi> </form> </main> <script>
    const qs  = (sel) => document.querySelector(sel);
    const qsa = (sel) => Array.from(document.querySelectorAll(sel));

    const formEl        = qs('form.lead-form');
    const radios        = qsa('input[name="hasWebsite"]');
    const websitesBlock = qs('.websites-block');
    const list          = document.getElementById('websites-list');
    const addBtn        = document.getElementById('add-website');
    const MAX = 3;

    if (formEl && websitesBlock && list && addBtn) {
      function makeWebsiteRow(initialValue = '') {
        const row = document.createElement('div');
        row.className = 'website-row';
        row.innerHTML = \\\`
          <input
            type="url"
            name="websites"
            inputmode="url"
            placeholder="https://example.com"
            value="\\\${initialValue.replace(/"/g,'&quot;')}"
            aria-label="Website URL"
            required
          />
          <button type="button" class="btn btn-remove" aria-label="Remove this website">\u2013</button>
        \\\`;
        row.querySelector('.btn-remove')?.addEventListener('click', () => {
          row.remove();
          updateAddButton();
          toggleRequired();
        });
        return row;
      }

      function updateAddButton() {
        const count = list.querySelectorAll('input[name="websites"]').length;
        addBtn.disabled = count >= MAX;
      }

      function toggleRequired() {
        const inputs = list.querySelectorAll('input[name="websites"]');
        inputs.forEach((inp, i) => { inp.required = (i === 0 && !websitesBlock.hidden); });
      }

      function showWebsitesBlock(show) {
        websitesBlock.hidden = !show;
        if (show && list.children.length === 0) list.appendChild(makeWebsiteRow());
        if (!show) list.innerHTML = '';
        updateAddButton();
        toggleRequired();
      }

      radios.forEach((r) => r.addEventListener('change', () => showWebsitesBlock(r.value === 'yes')));
      addBtn.addEventListener('click', () => {
        if (list.querySelectorAll('input[name="websites"]').length < MAX) {
          list.appendChild(makeWebsiteRow());
          updateAddButton();
          toggleRequired();
        }
      });

      // initial
      showWebsitesBlock(radios.find((r) => r.checked)?.value === 'yes');

      // Serialize all website inputs into a single hidden JSON field.
      const hiddenWebsites = document.createElement('input');
      hiddenWebsites.type = 'hidden';
      hiddenWebsites.name = 'websitesJson';
      formEl.appendChild(hiddenWebsites);

      formEl.addEventListener('submit', () => {
        const vals = qsa('input[name="websites"]')
          .map((i) => i.value.trim())
          .filter(Boolean)
          .slice(0, 3);
        hiddenWebsites.value = JSON.stringify(vals);

        // Avoid duplicate keys: remove 'name' from visible inputs
        qsa('input[name="websites"]').forEach((i) => i.removeAttribute('name'));
      });
    } else {
      console.warn('[lead-form] required elements not found; skipping script');
    }
  <\/script>  `])), maybeRenderHead()) })}`;
}, "/Users/donniestarkey/workspace/th/src/pages/form.astro", void 0);

const $$file = "/Users/donniestarkey/workspace/th/src/pages/form.astro";
const $$url = "/form";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Form,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
