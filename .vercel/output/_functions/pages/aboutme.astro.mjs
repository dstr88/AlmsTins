import { c as createComponent, r as renderComponent, a as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_BjWguqo6.mjs';
import 'kleur/colors';
import { $ as $$Layout } from '../chunks/Layout_DRU0i8Z_.mjs';
import '../chunks/index_DKHmmOtR.mjs';
import { $ as $$Image } from '../chunks/_astro_assets_DfzH7mKE.mjs';
/* empty css                                   */
export { renderers } from '../renderers.mjs';

const MeNLori = new Proxy({"src":"/_astro/MeNLori.WnK-gB2t.jpeg","width":216,"height":262,"format":"jpg","orientation":1}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/donniestarkey/workspace/th/src/assets/selfies/MeNLori.jpeg";
							}
							
							return target[name];
						}
					});

const $$AboutMe = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "Layout", $$Layout, { "data-astro-cid-5brriib5": true }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<main class="container" data-astro-cid-5brriib5> <h1 data-astro-cid-5brriib5>My Story</h1> <figure class="photo-figure" data-astro-cid-5brriib5> ${renderComponent($$result2, "Image", $$Image, { "src": MeNLori, "alt": "Me and Lori smiling together", "class": "photo", "widths": [320, 480, 640], "sizes": "(min-width: 768px) 50vw, 100vw", "loading": "eager", "decoding": "async", "data-astro-cid-5brriib5": true })} <figcaption class="caption" data-astro-cid-5brriib5>Donnie and Lori Starkey</figcaption> </figure> <section data-astro-cid-5brriib5> <p data-astro-cid-5brriib5>I’m an ESL (English as a Second Language) teacher at a local high school, and my work has always centered on helping people understand clearly—especially when language, systems, or ideas feel overwhelming.</p> <p data-astro-cid-5brriib5>I’ve also spent most of my life around computers and technology, drawn to the way good tools can simplify complexity and support meaningful work rather than distract from it.</p> <p data-astro-cid-5brriib5>That intersection became personal when my sister decided to leave her role at a counseling nonprofit and open her own private practice. When she asked, “So… what do I do next?” I helped in the ways I could—building her first website, working through a business plan, and supporting her as she opened her office in Maryville, Tennessee.</p> <p data-astro-cid-5brriib5>Walking alongside her through that process gave me a deep respect for Christian therapists, and the power found in web. They are often undervalued, underpaid, and misunderstood, even though they work from a foundation that acknowledges human brokenness, responsibility, and the possibility of real healing. That foundation is strong—and it deserves tools that reflect its depth.</p> <p data-astro-cid-5brriib5>Since then, my work has expanded beyond any single discipline. I’ve continued to deepen my technical skills—learning React for modern web applications, working in C++ to understand systems at a lower level, and exploring Solidity to better grasp how trust and logic operate in decentralized environments. I’ve also experimented with iPhone app development, drawn by the challenge of building tools that meet people where they already are.</p> <p data-astro-cid-5brriib5>Across all of this, the thread has remained the same: curiosity paired with passion to make the world a better place. I’m interested in how ideas move, how systems shape behavior, and how well-designed tools can reduce friction instead of adding to it. This site is a place to bring that work together—to think carefully, build responsibly, and apply new skills in ways that serve people rather than overwhelm them.</p> <p data-astro-cid-5brriib5>If that kind of work resonates with you, I invite you to follow along as these tools take shape, pass tests, are refined, and put to use in the ongoing effort to contribute something meaningful to the world we share.</p> </section> </main>  ` })}`;
}, "/Users/donniestarkey/workspace/th/src/pages/aboutMe.astro", void 0);

const $$file = "/Users/donniestarkey/workspace/th/src/pages/aboutMe.astro";
const $$url = "/aboutMe";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
	__proto__: null,
	default: $$AboutMe,
	file: $$file,
	url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
