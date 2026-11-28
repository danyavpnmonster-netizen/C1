import * as THREE from 'three';
import { makeHuman, mat } from './human.js';
import { SHOP_TYPES } from './city.js';

// Интерьер один на все магазины: стоит далеко за картой, меняется отделка и товары.
const IX = 4000, IZ = 0, W = 16, D = 12;
const EXIT = { x: IX, z: IZ - D / 2 + 0.9 };

const ITEMS = {
  market: [
    { name: 'Хот-дог', desc: '+25 здоровья', price: 15, apply: (g) => g.player.heal(25) },
    { name: 'Газировка', desc: '+10 здоровья', price: 5, apply: (g) => g.player.heal(10) },
    { name: 'Аптечка', desc: 'полное здоровье', price: 120, apply: (g) => g.player.heal(100) },
  ],
  guns: [
    { name: 'Патроны ×30', desc: 'для пистолета', price: 60, apply: (g) => g.player.addAmmo(30) },
    { name: 'Патроны ×90', desc: 'выгоднее', price: 150, apply: (g) => g.player.addAmmo(90) },
    { name: 'Бронежилет', desc: 'броня 100', price: 200, apply: (g) => { g.player.armor = 100; } },
  ],
  clothes: [
    { name: 'Спортивный', desc: 'зелёный костюм', price: 50, apply: (g) => g.player.setOutfit(0x2e8b57, 0x1e1e1e) },
    { name: 'Деловой', desc: 'рубашка и брюки', price: 120, apply: (g) => g.player.setOutfit(0xe8e8f0, 0x23283a) },
    { name: 'Пляжный', desc: 'гавайка и шорты', price: 40, apply: (g) => g.player.setOutfit(0xff8c42, 0x4a90c0) },
    { name: 'Байкер', desc: 'чёрная кожа', price: 90, apply: (g) => g.player.setOutfit(0x1a1a1a, 0x2a2a2a) },
  ],
};

export class Shops {
  constructor(game) {
    this.game = game;
    this.list = game.city.shops;
    this.inside = null;
    this.cd = 0; this.hintT = 0;
    this.panel = document.getElementById('shop');
    this.buildInterior();
    // кольца у дверей
    const ring = new THREE.RingGeometry(0.9, 1.25, 24).rotateX(-Math.PI / 2);
    for (const s of this.list) {
      const m = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffdd33, transparent: true, opacity: 0.8 }));
      m.position.set(s.door.x, 0.08, s.door.z);
      game.scene.add(m);
      s.ring = m;
    }
  }

  buildInterior() {
    const g = this.game, scene = g.scene, city = g.city;
    const group = this.group = new THREE.Group();
    const box = (m, sx, sy, sz, x, y, z) => {
      const b = new THREE.Mesh(city.unitBox, m);
      b.scale.set(sx, sy, sz); b.position.set(x, y, z); b.receiveShadow = true;
      group.add(b); return b;
    };
    this.wallMat = new THREE.MeshLambertMaterial({ color: 0xe8e0d0 });
    const floorMat = new THREE.MeshLambertMaterial({ color: 0xb8b0a0 });
    box(floorMat, W, 0.2, D, IX, -0.1, IZ);
    const t = 1.2, h = 4.5;
    box(this.wallMat, W + t * 2, h, t, IX, h / 2, IZ + D / 2 + t / 2);                 // северная
    box(this.wallMat, t, h, D, IX - W / 2 - t / 2, h / 2, IZ);                          // западная
    box(this.wallMat, t, h, D, IX + W / 2 + t / 2, h / 2, IZ);                          // восточная
    box(this.wallMat, W / 2 - 1.5 + t, h, t, IX - W / 4 - 0.75 - t / 2, h / 2, IZ - D / 2 - t / 2);   // южная слева
    box(this.wallMat, W / 2 - 1.5 + t, h, t, IX + W / 4 + 0.75 + t / 2, h / 2, IZ - D / 2 - t / 2);  // южная справа
    city.addCollider(IX - W / 2 - t, IX + W / 2 + t, IZ + D / 2, IZ + D / 2 + t, h);
    city.addCollider(IX - W / 2 - t, IX - W / 2, IZ - D / 2 - t, IZ + D / 2 + t, h);
    city.addCollider(IX + W / 2, IX + W / 2 + t, IZ - D / 2 - t, IZ + D / 2 + t, h);
    city.addCollider(IX - W / 2 - t, IX - 1.5, IZ - D / 2 - t, IZ - D / 2, h);
    city.addCollider(IX + 1.5, IX + W / 2 + t, IZ - D / 2 - t, IZ - D / 2, h);
    // выход — светлый проём
    box(new THREE.MeshBasicMaterial({ color: 0xfff6d8 }), 3, 3.2, 0.1, IX, 1.6, IZ - D / 2 - t);
    // прилавок
    this.counterMat = new THREE.MeshLambertMaterial({ color: 0x2e9e5b });
    box(this.counterMat, 8, 1.1, 1, IX, 0.55, IZ + 2.6);
    city.addCollider(IX - 4, IX + 4, IZ + 2.1, IZ + 3.1, 1.1);
    box(new THREE.MeshLambertMaterial({ color: 0x333333 }), 0.6, 0.4, 0.5, IX + 2.5, 1.3, IZ + 2.6);   // касса
    // стеллажи с товарами
    const shelfMat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
    const goods = [0xd04040, 0x40a0d0, 0xe0c040, 0x60c060, 0xd080d0, 0xf0f0f0];
    for (const sx of [-1, 1]) {
      box(shelfMat, 1, 2.4, 7, IX + sx * (W / 2 - 0.7), 1.2, IZ - 1);
      city.addCollider(IX + sx * (W / 2 - 0.7) - 0.5, IX + sx * (W / 2 - 0.7) + 0.5, IZ - 4.5, IZ + 2.5, 2.4);
      for (let row = 0; row < 3; row++) for (let k = 0; k < 6; k++) {
        box(mat(goods[(row + k) % goods.length]), 0.5, 0.45, 0.7, IX + sx * (W / 2 - 1.3), 0.6 + row * 0.75, IZ - 4 + k * 1.1);
      }
    }
    this.seller = makeHuman(0xf0f0f0, 0x333344, 0xc68642);
    this.seller.position.set(IX, 0, IZ + 3.8); this.seller.rotation.y = Math.PI;
    group.add(this.seller);
    // один источник света на все интерьеры: переносится туда, куда зашёл игрок
    const light = this.light = new THREE.PointLight(0xfff2d8, 40, 25);
    light.position.set(IX, 4, IZ);
    scene.add(light);
    scene.add(group);
  }

  enter(s) {
    const g = this.game, p = g.player;
    this.inside = s;
    this.counterMat.color.setHex(s.color);
    this.wallMat.color.setHex(s.type === 'guns' ? 0xc8c0b0 : s.type === 'clothes' ? 0xf0e4f0 : 0xe8e0d0);
    p.pos.set(IX, 0, IZ - D / 2 + 2.6); p.facing = 0; p.vy = 0;
    this.light.position.set(IX, 4, IZ);
    g.camYaw = 0; g.camPitch = 0.35;
    this.cd = 1;
    g.hud.message(SHOP_TYPES[s.type].name + ' — подойдите к прилавку', 2.5);
    g.sfx.check();
  }

  exit() {
    const g = this.game, p = g.player, s = this.inside;
    this.inside = null;
    this.closePanel();
    p.pos.set(s.door.x + s.door.nx * 1.8, 0, s.door.z + s.door.nz * 1.8);
    p.facing = Math.atan2(s.door.nx, s.door.nz); g.camYaw = p.facing;
    this.cd = 1.5;
  }

  openPanel() {
    if (this.panelOpen) return;
    this.panelOpen = true;
    const s = this.inside, items = ITEMS[s.type];
    this.panel.innerHTML = `<h3>${SHOP_TYPES[s.type].name}</h3>` + items.map((it, i) =>
      `<button data-i="${i}"><b>${i + 1}</b><span>${it.name}<small>${it.desc}</small></span><em>$${it.price}</em></button>`).join('')
      + '<p>Цифры 1–4 или нажмите на товар. Выход — к двери.</p>';
    this.panel.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.buy(+b.dataset.i)));
    this.panel.style.display = 'block';
    if (document.pointerLockElement) document.exitPointerLock();
  }

  closePanel() {
    if (!this.panelOpen) return;
    this.panelOpen = false;
    this.panel.style.display = 'none';
  }

  buy(i) {
    const g = this.game, it = ITEMS[this.inside?.type]?.[i];
    if (!it) return;
    if (g.player.money < it.price) { g.hud.message('Не хватает денег', 1.5); g.sfx.fail(); return; }
    g.addMoney(-it.price);
    it.apply(g);
    g.hud.message(`Куплено: ${it.name}`, 1.5);
    g.sfx.cash();
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.cd = Math.max(0, this.cd - dt);
    this.hintT -= dt;
    for (const s of this.list) s.ring.material.opacity = 0.5 + Math.sin(g.time * 4) * 0.3;
    if (g.state !== 'play') { if (this.inside) this.exit(); return; }
    if (this.inside) {
      const nearCounter = p.pos.z > IZ + 0.6;
      if (nearCounter) this.openPanel(); else this.closePanel();
      if (this.panelOpen) for (let i = 0; i < 4; i++) if (g.input.pressed('Digit' + (i + 1))) this.buy(i);
      if (this.cd <= 0 && Math.hypot(p.pos.x - EXIT.x, p.pos.z - EXIT.z) < 1.2) this.exit();
      return;
    }
    if (p.car || this.cd > 0) return;
    for (const s of this.list) {
      if (Math.hypot(p.pos.x - s.door.x, p.pos.z - s.door.z) > 1.3) continue;
      if (g.wanted > 0) {
        if (this.hintT <= 0) { g.hud.message('Сначала оторвитесь от полиции', 2); this.hintT = 2.5; }
      } else this.enter(s);
    }
  }
}
