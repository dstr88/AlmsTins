import { c as createComponent, g as createAstro, m as maybeRenderHead, i as addAttribute, a as renderTemplate, l as renderSlot, r as renderComponent } from '../chunks/astro/server_BjWguqo6.mjs';
import 'kleur/colors';
import { $ as $$Layout } from '../chunks/Layout_DRU0i8Z_.mjs';
import 'clsx';
/* empty css                                 */
export { renderers } from '../renderers.mjs';

const $$Astro = createAstro();
const $$Card = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Card;
  const {
    title = "",
    eyebrow = "",
    hook = "",
    cta = "",
    href = "",
    className = ""
  } = Astro2.props;
  return renderTemplate`${maybeRenderHead()}<article${addAttribute(`card ${className}`.trim(), "class")} data-astro-cid-hpdudsth> ${eyebrow ? renderTemplate`<p class="card-eyebrow" data-astro-cid-hpdudsth>${eyebrow}</p>` : null} ${title ? renderTemplate`<h3 class="card-title" data-astro-cid-hpdudsth>${title}</h3>` : null} ${hook ? renderTemplate`<p class="card-hook" data-astro-cid-hpdudsth>${hook}</p>` : renderTemplate`${renderSlot($$result, $$slots["default"])}`} ${cta && href ? renderTemplate`<a class="card-cta"${addAttribute(href, "href")} data-astro-cid-hpdudsth> ${cta} </a>` : null} </article> `;
}, "/Users/donniestarkey/workspace/th/src/components/card.astro", void 0);

const Feather = new Proxy({"src":"/_astro/feather.DT-pEbS7.png","width":1280,"height":902,"format":"png"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/donniestarkey/workspace/th/src/assets/feather.png";
							}
							
							return target[name];
						}
					});

const $$Quill = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${maybeRenderHead()}<section class="quill-section" data-astro-cid-kukpp6vm> <div class="backdrop" data-astro-cid-kukpp6vm> <img${addAttribute(Feather.src, "src")} alt="Feather Icon" class="feather-top" data-astro-cid-kukpp6vm> </div> <div class="quill-text" data-astro-cid-kukpp6vm> <h1 data-astro-cid-kukpp6vm>Helping people see clearly, equipping them well, and stewarding ideas through complex systems.</h1> </div> <div class="quill" data-astro-cid-kukpp6vm> <p data-astro-cid-kukpp6vm>Below are examples of how this work takes shape—through web applications and tools
  designed to bring clarity, support thoughtful leadership, and steward ideas within complex systems.
</p>  </div> </section> `;
}, "/Users/donniestarkey/workspace/th/src/components/Quill.astro", void 0);

const $$Index = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "Layout", $$Layout, { "data-astro-cid-j7pv25f6": true }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<main class="content-wrap" data-astro-cid-j7pv25f6> <div class="one-column" data-astro-cid-j7pv25f6> <h1 class="page-title" data-astro-cid-j7pv25f6>Developing apps for a brighter tomorrow.</h1> ${renderComponent($$result2, "Quill", $$Quill, { "data-astro-cid-j7pv25f6": true })} <section class="card-row" data-astro-cid-j7pv25f6> ${renderComponent($$result2, "Card", $$Card, { "title": "Live Project: Christian Therapy Practice", "data-astro-cid-j7pv25f6": true }, { "default": ($$result3) => renderTemplate` <p data-astro-cid-j7pv25f6>A fully deployed website built for a Christian therapist, designed to communicate a Christ-centered understanding of care with clarity, professionalism, and warmth.</p> <p data-astro-cid-j7pv25f6>This project reflects how faith, ethics, and thoughtful design can work together in a real-world clinical practice.</p> <p data-astro-cid-j7pv25f6> <a href="https://thelionslamb.com" target="_blank" rel="noopener noreferrer" data-astro-cid-j7pv25f6>
View the live site →</a> </p> ` })} ${renderComponent($$result2, "Card", $$Card, { "title": "In Development: Financial Clarity Tools", "data-astro-cid-j7pv25f6": true }, { "default": ($$result3) => renderTemplate` <p data-astro-cid-j7pv25f6>I’m developing analytical tools designed to bring clarity to personal and system-level financial decisions—bringing income, expenses, obligations, and debt into a single, understandable view.</p> <p data-astro-cid-j7pv25f6>This work focuses on reducing noise in complex financial systems, including both traditional finance and emerging digital assets.</p> <p data-astro-cid-j7pv25f6> <em data-astro-cid-j7pv25f6>Currently in active development.</em> </p> ` })} ${renderComponent($$result2, "Card", $$Card, { "title": "Exploring: Reading Comprehension Builder", "data-astro-cid-j7pv25f6": true }, { "default": ($$result3) => renderTemplate` <p data-astro-cid-j7pv25f6> I’m designing a tool that helps students understand what they read by slowing the process down in the right way. Students read a short section, click <strong data-astro-cid-j7pv25f6>Next</strong>, and answer a few questions before moving on.</p> <p data-astro-cid-j7pv25f6>They can move back to reread anytime—but as they progress, questions become cumulative, requiring them to remember and connect details across multiple sections.</p> <p data-astro-cid-j7pv25f6><em data-astro-cid-j7pv25f6>Want to pilot this with students? <strong data-astro-cid-j7pv25f6>Reach out.</strong></em></p> ` })} </section> </div> </main>  ` })}`;
}, "/Users/donniestarkey/workspace/th/src/pages/index.astro", void 0);

const $$file = "/Users/donniestarkey/workspace/th/src/pages/index.astro";
const $$url = "";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
