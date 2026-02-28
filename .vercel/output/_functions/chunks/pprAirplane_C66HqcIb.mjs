const FastCar = new Proxy({"src":"/_astro/FastCar.4HkaC8sS.jpg","width":480,"height":640,"format":"jpg"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/donniestarkey/workspace/th/src/assets/FastCar.jpg";
							}
							
							return target[name];
						}
					});

const PprPlane = new Proxy({"src":"/_astro/pprAirplane.DnMuLGS2.png","width":640,"height":640,"format":"png"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/donniestarkey/workspace/th/src/assets/pprAirplane.png";
							}
							
							return target[name];
						}
					});

export { FastCar as F, PprPlane as P };
