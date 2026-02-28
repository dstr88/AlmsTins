import { c as createComponent, a as renderTemplate, i as addAttribute, m as maybeRenderHead, g as createAstro, n as renderHead, l as renderSlot, r as renderComponent } from './astro/server_BjWguqo6.mjs';
import 'kleur/colors';
import 'clsx';
/* empty css                           */

const Portrait = new Proxy({"src":"/_astro/coverpic1.BxgVLrDe.jpeg","width":3024,"height":4032,"format":"jpg","orientation":1}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/donniestarkey/workspace/th/src/assets/selfies/coverpic1.jpeg";
							}
							
							return target[name];
						}
					});

const Logo = new Proxy({"src":"/_astro/titaniumHutLogo.cKNrMZWR.png","width":100,"height":133,"format":"png"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/donniestarkey/workspace/th/src/assets/titaniumHutLogo.png";
							}
							
							return target[name];
						}
					});

var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(cooked.slice()) }));
var _a;
const $$Hero = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate(_a || (_a = __template(["", '<section class="hero hero--top" data-astro-cid-bbe6dxrz> <div class="hero-inner" data-astro-cid-bbe6dxrz> <!-- \u2B05\uFE0F Logo Card --> <div class="hero-logo-card" data-astro-cid-bbe6dxrz> <img', ' alt="Titanium Hut" class="hero-logo-img" data-astro-cid-bbe6dxrz> <p class="hero-logo-caption" data-astro-cid-bbe6dxrz>Support for Therapists who support God\u2019s people</p> </div> <!-- \u27A1\uFE0F Donnie Card --> <div class="hero-card" data-astro-cid-bbe6dxrz> <img', ` alt="Donnie Starkey" class="hero-card__img" data-astro-cid-bbe6dxrz> <div class="hero-card__body" data-astro-cid-bbe6dxrz> <div class="brushstroke-box" data-astro-cid-bbe6dxrz> <p class="artist-name" data-astro-cid-bbe6dxrz>Donnie Starkey</p> <a href="mailto:Donnie@titaniumhut.com" class="artist-email" data-astro-cid-bbe6dxrz>
Donnie@titaniumhut.com
</a> </div> </div> </div> <!-- \u{1F517} Jagged Nav (spans under both cards) --> <nav class="jagged-navbar" id="jagged-navbar" data-astro-cid-bbe6dxrz> <div class="jagged-links" data-astro-cid-bbe6dxrz> <a href="/" class="jagged-link" data-astro-cid-bbe6dxrz>Home</a> <a href="/aboutMe" class="jagged-link" data-astro-cid-bbe6dxrz>About Us</a> <a href="/customSites" class="jagged-link" data-astro-cid-bbe6dxrz>our product</a> </div> </nav> </div> </section> <script>
  document.getElementById('menu-toggle')?.addEventListener('click', () => {
    document.querySelector('.jagged-links')?.classList.toggle('expanded');
  });
<\/script> `])), maybeRenderHead(), addAttribute(Logo.src, "src"), addAttribute(Portrait.src, "src"));
}, "/Users/donniestarkey/workspace/th/src/components/Hero.astro", void 0);

const $$Astro = createAstro();
const $$Layout = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Layout;
  const {
    title = "WebDev services, Cookeville TN | Titanium Hut",
    description = "Web applications and development in Cookeville, TN for Businesses, Defi and Education.",
    canonical = "https://titaniumhut.com",
    image = "https://titaniumhut.com/og/Donnie.jpeg",
    showHero = true
  } = Astro2.props;
  return renderTemplate`<html lang="en" data-theme="olivewine"> <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description"${addAttribute(description, "content")}>${canonical ? renderTemplate`<link rel="canonical"${addAttribute(canonical, "href")}>` : null}${image ? renderTemplate`<meta property="og:image"${addAttribute(image, "content")}>` : null}<!-- tiny inline favicon to silence /favicon.ico 404s --><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🚀%3C/text%3E%3C/svg%3E"><!-- Fonts --><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Pacifico&family=Libre+Baskerville&display=swap" rel="stylesheet">${renderHead()}</head> <body> ${showHero ? renderTemplate`${renderComponent($$result, "Hero", $$Hero, {})}` : null} ${renderSlot($$result, $$slots["default"])} </body></html>`;
}, "/Users/donniestarkey/workspace/th/src/layouts/Layout.astro", void 0);

export { $$Layout as $ };
