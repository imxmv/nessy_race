/* ============================================================
   ПОБЕГ — браузерная 3D-игра про погоню (Three.js)
   Tiguan (игрок) против красного Porsche Cayenne (преследователи)
   ============================================================ */
(function () {
    'use strict';

    /* ---------- Конфигурация ---------- */
    const CFG = {
        PLAYER_ACCEL_PER_PRESS: 6.0,   // скорость за одно нажатие Space
        PLAYER_MAX_SPEED: 46,
        PLAYER_DECAY_PER_SEC: 0.70,    // спад скорости в секунду
        ENEMY_BASE: 18,                // базовый ход Porsche
        ENEMY_FACTOR: 0.5,             // ... + доля от скорости игрока
        START_GAP: 34,                 // стартовое расстояние (z) между машинами
        GAP_MAX: 70,                   // масштаб шкалы
        WIN_GAP: 66,                   // расстояние для победы
        LOSE_GAP: 4,                   // расстояние для поражения
        ROAD_LENGTH: 20000,
        ROAD_WIDTH: 13
    };

    const rand = (a, b) => a + Math.random() * (b - a);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    /* ---------- DOM ---------- */
    const container = document.getElementById('game-container');
    const hud = document.getElementById('hud');
    const barFill = document.getElementById('bar-fill');
    const barPointer = document.getElementById('bar-pointer');
    const vignette = document.getElementById('danger-vignette');
    const speedHint = document.getElementById('speed-hint');
    const screenStart = document.getElementById('screen-start');
    const screenWin = document.getElementById('screen-win');
    const screenLose = document.getElementById('screen-lose');
    const btnStart = document.getElementById('btn-start');
    const btnRestart = document.getElementById('btn-restart');
    const btnRetry = document.getElementById('btn-retry');

    /* ---------- Рендерер, сцена, камера ---------- */
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8fb8e8);

    const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1600);

    /* ---------- Текстуры (процедурные) ---------- */
    function makeCanvas(size) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        return c;
    }

    function makeRoadTexture() {
        const c = makeCanvas(256);
        const g = c.getContext('2d');
        g.fillStyle = '#3a3d42';
        g.fillRect(0, 0, 256, 256);
        // асфальтовый шум
        for (let i = 0; i < 900; i++) {
            const v = 58 + Math.random() * 18 | 0;
            g.fillStyle = `rgb(${v},${v},${v + 4})`;
            g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
        }
        // сплошные белые края
        g.fillStyle = '#e8e8e8';
        g.fillRect(18, 0, 5, 256);
        g.fillRect(233, 0, 5, 256);
        // центральная прерывистая жёлтая разметка
        g.fillStyle = '#e8c33a';
        for (let y = 0; y < 256; y += 40) {
            g.fillRect(126, y, 4, 20);
        }
        const t = new THREE.CanvasTexture(c);
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        return t;
    }

    function makeGrassTexture() {
        const c = makeCanvas(128);
        const g = c.getContext('2d');
        g.fillStyle = '#5d8a3c';
        g.fillRect(0, 0, 128, 128);
        for (let i = 0; i < 600; i++) {
            const shade = Math.random();
            g.fillStyle = shade > 0.5 ? '#6c9c46' : '#4f7a33';
            g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
        }
        const t = new THREE.CanvasTexture(c);
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        return t;
    }

    /* ---------- Небо (градиент) ---------- */
    const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
            topColor: { value: new THREE.Color(0x1d3a6b) },
            horizonColor: { value: new THREE.Color(0xffb35c) },
            offset: { value: 20 },
            exponent: { value: 0.9 }
        },
        vertexShader: `
            varying vec3 vWorld;
            void main(){
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vWorld = wp.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            uniform vec3 topColor;
            uniform vec3 horizonColor;
            uniform float offset;
            uniform float exponent;
            varying vec3 vWorld;
            void main(){
                float h = normalize(vWorld + vec3(0.0, offset, 0.0)).y;
                float t = pow(max(h, 0.0), exponent);
                gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
            }`
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 20), skyMat);
    sky.frustumCulled = false;
    scene.add(sky);

    const FOG_COLOR = new THREE.Color(0xb7c8e0);
    scene.fog = new THREE.Fog(FOG_COLOR, 120, 900);

    /* ---------- Освещение ---------- */
    const hemi = new THREE.HemisphereLight(0xfff2dd, 0x3a4a5a, 0.65);
    scene.add(hemi);

    const ambient = new THREE.AmbientLight(0x8090a8, 0.35);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffca8a, 1.5);
    sun.position.set(60, 100, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 300;
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    scene.add(sun.target);

    /* ---------- Земля и поля ---------- */
    const grassTex = makeGrassTexture();
    grassTex.repeat.set(300, 300);
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(2600, CFG.ROAD_LENGTH),
        new THREE.MeshStandardMaterial({ map: grassTex, color: 0x9db26a })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.05, -CFG.ROAD_LENGTH / 2 + 40);
    ground.receiveShadow = true;
    scene.add(ground);

    // Поля по бокам
    const fieldGeo = new THREE.PlaneGeometry(600, CFG.ROAD_LENGTH);
    const fieldLeft = new THREE.Mesh(fieldGeo, new THREE.MeshStandardMaterial({ color: 0x6f9a3a, roughness: 1 }));
    fieldLeft.rotation.x = -Math.PI / 2;
    fieldLeft.position.set(-800, 0.01, -CFG.ROAD_LENGTH / 2 + 40);
    scene.add(fieldLeft);
    const fieldRight = new THREE.Mesh(fieldGeo.clone(), new THREE.MeshStandardMaterial({ color: 0x7fa848, roughness: 1 }));
    fieldRight.rotation.x = -Math.PI / 2;
    fieldRight.position.set(800, 0.01, -CFG.ROAD_LENGTH / 2 + 40);
    scene.add(fieldRight);

    /* ---------- Дорога ---------- */
    const roadTex = makeRoadTexture();
    roadTex.repeat.set(1, CFG.ROAD_LENGTH / 20);
    roadTex.anisotropy = 4;
    const road = new THREE.Mesh(
        new THREE.PlaneGeometry(CFG.ROAD_WIDTH, CFG.ROAD_LENGTH),
        new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95, metalness: 0.1 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.001, -CFG.ROAD_LENGTH / 2 + 40);
    road.receiveShadow = true;
    scene.add(road);

    // обочины (асфальтовые полосы по краям дороги)
    const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x5a5e63, roughness: 1 });
    for (const sx of [-1, 1]) {
        const shoulder = new THREE.Mesh(
            new THREE.PlaneGeometry(3.5, CFG.ROAD_LENGTH),
            shoulderMat
        );
        shoulder.rotation.x = -Math.PI / 2;
        shoulder.position.set(sx * (CFG.ROAD_WIDTH / 2 + 1.75), 0.0005, -CFG.ROAD_LENGTH / 2 + 40);
        scene.add(shoulder);
    }

    /* ---------- Придорожные объекты (бесконечные) ---------- */
    const scenery = []; // { group, spawnZ }

    function addScenery(group) {
        scene.add(group);
        scenery.push({ group, spawnZ: group.position.z });
    }

    function makeTree(x, z) {
        const isPine = Math.random() < 0.6;
        const s = rand(0.8, 1.5);
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = rand(0, Math.PI * 2);
        if (isPine) {
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.28, 0.42, 2.2, 7),
                new THREE.MeshStandardMaterial({ color: 0x5c4430, roughness: 1 })
            );
            trunk.position.y = 1.1;
            trunk.scale.set(s, s, s);
            g.add(trunk);
            let ty = 3.2;
            let r = 2.2;
            for (let i = 0; i < 3; i++) {
                const cone = new THREE.Mesh(
                    new THREE.ConeGeometry(r, 2.6, 8),
                    new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 1 })
                );
                cone.position.y = ty;
                cone.scale.set(s, s, s);
                cone.castShadow = true;
                g.add(cone);
                ty += 1.5;
                r *= 0.72;
            }
        } else {
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.24, 0.34, 2.0, 7),
                new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 })
            );
            trunk.position.y = 1.0;
            trunk.scale.set(s, s, s);
            g.add(trunk);
            const crown = new THREE.Mesh(
                new THREE.SphereGeometry(1.7, 9, 8),
                new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 1 })
            );
            crown.position.y = 3.0;
            crown.scale.set(s, s, s);
            crown.castShadow = true;
            g.add(crown);
        }
        return g;
    }

    function makeBush(x, z) {
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        const mat = new THREE.MeshStandardMaterial({ color: 0x3f6d35, roughness: 1 });
        for (let i = 0; i < 3; i++) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(rand(0.4, 0.8), 7, 6), mat);
            b.position.set(rand(-0.6, 0.6), rand(0.2, 0.5), rand(-0.6, 0.6));
            g.add(b);
        }
        return g;
    }

    function makeLamp(x, z) {
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.12, 0.16, 6.5, 8),
            new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.6, metalness: 0.4 })
        );
        pole.position.y = 3.25;
        g.add(pole);
        const arm = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 0.1, 0.1),
            new THREE.MeshStandardMaterial({ color: 0x3c4046, metalness: 0.4 })
        );
        arm.position.set(0.8, 6.4, 0);
        g.add(arm);
        const bulb = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.12, 0.3),
            new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd98a, emissiveIntensity: 1.6 })
        );
        bulb.position.set(1.55, 6.32, 0);
        g.add(bulb);
        return g;
    }

    function makeSign(x, z, round) {
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.09, 0.11, 3.2, 7),
            new THREE.MeshStandardMaterial({ color: 0x7a7a7a, metalness: 0.5, roughness: 0.5 })
        );
        post.position.y = 1.6;
        g.add(post);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
        let face;
        if (round) {
            face = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), mat);
            face.position.y = 3.1;
            face.rotation.y = -Math.PI / 2;
            face.rotation.x = -Math.PI / 2;
        } else {
            face = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.06), mat);
            face.position.set(0, 3.0, 0.05);
        }
        face.castShadow = true;
        g.add(face);
        return g;
    }

    // Расставляем объекты вдоль дороги (обе стороны)
    const sceneries = [
        { make: makeTree, count: 150, spacing: 26, near: 9 },
        { make: makeBush, count: 90, spacing: 40, near: 8 },
        { make: makeLamp, count: 60, spacing: 55, near: 8 },
        { make: makeSign, count: 18, spacing: 180, near: 8, round: true }
    ];

    sceneries.forEach(cfg => {
        const halfSpan = CFG.ROAD_WIDTH / 2 + 4;
        for (let i = 0; i < cfg.count; i++) {
            const side = i % 2 === 0 ? -1 : 1;
            const z = -i * cfg.spacing - rand(0, cfg.spacing * 0.6);
            const x = side * rand(halfSpan + cfg.near, halfSpan + cfg.near + 40);
            addScenery(cfg.make(x, z, cfg.round));
        }
    });

    // Беспорядочные деревья на полях подальше
    for (let i = 0; i < 120; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const x = side * rand(90, 480);
        const z = -rand(0, 2600);
        const t = makeTree(x, z);
        t.scale.multiplyScalar(rand(1.2, 2.2));
        addScenery(t);
    }

    // Сено (для деревенского настроения)
    for (let i = 0; i < 40; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const g = new THREE.Group();
        g.position.set(side * rand(60, 140), 0, -rand(0, 2600));
        g.rotation.y = rand(0, Math.PI);
        const bale = new THREE.Mesh(
            new THREE.CylinderGeometry(1.1, 1.1, 1.5, 14),
            new THREE.MeshStandardMaterial({ color: 0xc9a44b, roughness: 1 })
        );
        bale.rotation.z = Math.PI / 2;
        bale.castShadow = true;
        g.add(bale);
        addScenery(g);
    }

    /* ---------- Персонажи ---------- */
    const SKIN = 0xe8b48c;
    const SKIN_DARK = 0xd9a071;

    function buildHead(hairColor, hairStyle) {
        const g = new THREE.Group();
        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.16, 16, 14),
            new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 })
        );
        head.position.y = 1.62;
        head.castShadow = true;
        g.add(head);
        // волосы
        if (hairStyle === 'short') {
            const hair = new THREE.Mesh(
                new THREE.SphereGeometry(0.165, 16, 12),
                new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.8 })
            );
            hair.scale.set(1.02, 0.75, 1.05);
            hair.position.y = 1.68;
            g.add(hair);
        } else if (hairStyle === 'long') {
            const hair = new THREE.Mesh(
                new THREE.SphereGeometry(0.17, 16, 12),
                new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.7 })
            );
            hair.scale.set(1.04, 1.05, 1.05);
            hair.position.y = 1.72;
            g.add(hair);
            const fall = new THREE.Mesh(
                new THREE.ConeGeometry(0.13, 0.55, 12),
                new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.7 })
            );
            fall.position.y = 1.15;
            fall.rotation.x = Math.PI;
            g.add(fall);
        } else {
            // пучок
            const hair = new THREE.Mesh(
                new THREE.SphereGeometry(0.165, 16, 12),
                new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.8 })
            );
            hair.scale.set(1.02, 0.7, 1.02);
            hair.position.y = 1.66;
            g.add(hair);
            const bun = new THREE.Mesh(
                new THREE.SphereGeometry(0.07, 10, 8),
                new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.8 })
            );
            bun.position.set(0, 1.82, -0.02);
            g.add(bun);
        }
        return g;
    }

    // Мужчина (водитель Tiguan): короткие тёмные волосы, белое поло
    function buildMan() {
        const g = new THREE.Group();
        const shirt = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 });
        const pants = new THREE.MeshStandardMaterial({ color: 0x2a3a4a, roughness: 0.8 });
        // ноги
        for (const sx of [-0.09, 0.09]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.16), pants);
            leg.position.set(sx, 0.25, 0);
            g.add(leg);
        }
        // торс
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.28), shirt);
        torso.position.y = 0.78;
        g.add(torso);
        // голова
        const headGrp = buildHead(0x3a2c22, 'short');
        headGrp.position.set(0, 0, 0.02);
        g.add(headGrp);
        // руки к рулю (в шарнирах-группах для анимации)
        const arms = [];
        for (const sx of [-0.24, 0.24]) {
            const pivot = new THREE.Group();
            pivot.position.set(sx, 1.0, 0.15);
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.46, 0.09), shirt);
            arm.position.y = -0.23;
            arm.rotation.z = sx < 0 ? 0.5 : -0.5;
            pivot.add(arm);
            g.add(pivot);
            arms.push(pivot);
        }
        g.userData.arms = arms;
        g.userData.head = headGrp;
        return g;
    }

    // Женщина (преследовательница) с платьем и причёской
    function buildWoman(hairColor, hairStyle, dressColor) {
        const g = new THREE.Group();
        const dress = new THREE.MeshStandardMaterial({ color: dressColor, roughness: 0.65 });
        const skinMat = new THREE.MeshStandardMaterial({ color: SKIN_DARK, roughness: 0.7 });
        // ноги (частично видно)
        for (const sx of [-0.08, 0.08]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.14), skinMat);
            leg.position.set(sx, 0.21, 0);
            g.add(leg);
        }
        // торс-платье (расширяется к низу)
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.26), dress);
        torso.position.y = 0.8;
        g.add(torso);
        const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.3, 12), dress);
        skirt.position.y = 0.42;
        g.add(skirt);
        // голова
        const headGrp = buildHead(hairColor, hairStyle);
        headGrp.position.set(0, 0, 0.02);
        g.add(headGrp);
        // руки (в шарнирах для анимации "приставания")
        const arms = [];
        for (const sx of [-0.18, 0.18]) {
            const pivot = new THREE.Group();
            pivot.position.set(sx, 1.0, 0.12);
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.08), skinMat);
            arm.position.y = -0.21;
            arm.rotation.z = sx < 0 ? 0.5 : -0.5;
            pivot.add(arm);
            g.add(pivot);
            arms.push(pivot);
        }
        g.userData.arms = arms;
        g.userData.head = headGrp;
        return g;
    }

    /* ---------- Автомобили ---------- */
    const wheelSpinGroups = []; // группы колёс для вращения

    function buildWheel() {
        const grp = new THREE.Group();
        const tire = new THREE.Mesh(
            new THREE.CylinderGeometry(0.36, 0.36, 0.28, 20),
            new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 })
        );
        tire.rotation.z = Math.PI / 2;
        tire.castShadow = true;
        grp.add(tire);
        const hub = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.18, 0.3, 12),
            new THREE.MeshStandardMaterial({ color: 0xcfcfcf, metalness: 0.7, roughness: 0.3 })
        );
        hub.rotation.z = Math.PI / 2;
        grp.add(hub);
        wheelSpinGroups.push(grp);
        return grp;
    }

    // Volkswagen Tiguan — белый/серебристый компактный кроссовер
    function buildTiguan(color) {
        const g = new THREE.Group();
        const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.35 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.4, metalness: 0.4 });
        const glass = new THREE.MeshStandardMaterial({
            color: 0x0d1116, metalness: 0.8, roughness: 0.1,
            transparent: true, opacity: 0.5, depthWrite: false
        });
        const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.95, roughness: 0.15 });
        const red = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xcc0000, emissiveIntensity: 1.4 });
        const white = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6c0, emissiveIntensity: 1.8 });

        const add = (m, x, y, z, sx, sy, sz, mat, cast) => {
            m.scale.set(sx, sy, sz);
            m.position.set(x, y, z);
            m.material = mat;
            m.castShadow = cast !== false;
            g.add(m);
            return m;
        };

        // нижний кузов
        add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.5)), 0, 0.42, 0, 1, 1, 1, paint);
        // капот и багажник (чуть ниже)
        add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.4, 1.1)), 0, 0.32, -2.0, 1, 1, 1, paint);
        add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.42, 0.9)), 0, 0.34, 1.95, 1, 1, 1, paint);
        // кабина (стекло)
        add(new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.62, 2.5)), 0, 0.95, -0.35, 1, 1, 1, glass);
        // крыша
        add(new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.08, 2.5)), 0, 1.32, -0.35, 1, 1, 1, paint);
        // рейлинги
        for (const sx of [-0.72, 0.72]) {
            add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 2.1)), sx, 1.4, -0.35, 1, 1, 1, chrome);
        }
        // бамперы
        add(new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.4, 0.35)), 0, 0.3, -2.28, 1, 1, 1, dark);
        add(new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.42, 0.35)), 0, 0.32, 2.28, 1, 1, 1, dark);
        // решётка радиатора + эмблема VW
        add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.12)), 0, 0.62, -2.26, 1, 1, 1, dark);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 20)), 0, 0.78, -2.27, 1, 1, 1, chrome);
        // фары
        add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.1)), -0.62, 0.7, -2.25, 1, 1, 1, white);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.1)), 0.62, 0.7, -2.25, 1, 1, 1, white);
        // задние фонари (стиль Tiguan)
        add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.08)), -0.66, 0.68, 2.26, 1, 1, 1, red);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.08)), 0.66, 0.68, 2.26, 1, 1, 1, red);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.06)), 0, 0.62, 2.26, 1, 1, 1, red);
        // зеркала
        add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.14)), -0.98, 1.05, -0.7, 1, 1, 1, paint);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.14)), 0.98, 1.05, -0.7, 1, 1, 1, paint);
        // нижняя обвеска (колёсные арки)
        add(new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.14, 3.6)), 0, 0.16, 0, 1, 1, 1, dark);

        // колёса
        const wheelPos = [[-0.85, -1.35], [0.85, -1.35], [-0.85, 1.35], [0.85, 1.35]];
        wheelPos.forEach(([wx, wz]) => {
            const w = buildWheel();
            w.position.set(wx, 0.36, wz);
            g.add(w);
        });

        // руль + водитель (слева, LHD)
        const wheel3d = new THREE.Mesh(
            new THREE.TorusGeometry(0.14, 0.03, 8, 20),
            new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
        );
        wheel3d.position.set(-0.32, 1.02, -0.95);
        wheel3d.rotation.x = Math.PI / 2;
        g.add(wheel3d);

        const man = buildMan();
        man.position.set(-0.32, 0.05, -0.5);
        man.scale.setScalar(0.62);
        g.add(man);
        g.userData.driver = man;

        return { group: g };
    }

    // Красный Porsche Cayenne — спортивный кроссовер
    function buildCayenne() {
        const g = new THREE.Group();
        const paint = new THREE.MeshStandardMaterial({ color: 0xb00615, metalness: 0.6, roughness: 0.25 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.4, metalness: 0.5 });
        const glass = new THREE.MeshStandardMaterial({
            color: 0x0c1014, metalness: 0.8, roughness: 0.08,
            transparent: true, opacity: 0.45, depthWrite: false
        });
        const white = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6c0, emissiveIntensity: 2.0 });
        const red = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xcc0000, emissiveIntensity: 1.6 });

        const add = (m, x, y, z, sx, sy, sz, mat, cast) => {
            m.scale.set(sx, sy, sz);
            m.position.set(x, y, z);
            m.material = mat;
            m.castShadow = cast !== false;
            g.add(m);
            return m;
        };

        // кузов — ниже и шире, спорт-внедорожник
        add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 4.7)), 0, 0.4, 0, 1, 1, 1, paint);
        add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.34, 1.3)), 0, 0.3, -2.1, 1, 1, 1, paint);
        add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.36, 1.0)), 0, 0.32, 2.1, 1, 1, 1, paint);
        // покатая кабина
        add(new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.6, 2.7)), 0, 0.92, -0.4, 1, 1, 1, glass);
        add(new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.08, 2.6)), 0, 1.26, -0.4, 1, 1, 1, paint);
        // бамперы + решётка
        add(new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.36, 0.36)), 0, 0.26, -2.42, 1, 1, 1, dark);
        add(new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.36, 0.36)), 0, 0.28, 2.42, 1, 1, 1, dark);
        add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.28, 0.14)), 0, 0.6, -2.4, 1, 1, 1, dark);
        // фары (острые, низкие)
        add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.12)), -0.72, 0.66, -2.4, 1, 1, 1, white);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.12)), 0.72, 0.66, -2.4, 1, 1, 1, white);
        // задние фонари
        add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.08)), -0.7, 0.66, 2.4, 1, 1, 1, red);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.08)), 0.7, 0.66, 2.4, 1, 1, 1, red);
        // зеркала
        add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.14)), -1.0, 1.0, -0.75, 1, 1, 1, paint);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.14)), 1.0, 1.0, -0.75, 1, 1, 1, paint);
        // нижняя обвеска
        add(new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.14, 3.8)), 0, 0.14, 0, 1, 1, 1, dark);

        // колёса (спортивные)
        const wheelPos = [[-0.9, -1.4], [0.9, -1.4], [-0.9, 1.4], [0.9, 1.4]];
        wheelPos.forEach(([wx, wz]) => {
            const w = buildWheel();
            w.position.set(wx, 0.36, wz);
            g.add(w);
        });

        // руль + две женщины (водитель слева, пассажир справа)
        const wheel3d = new THREE.Mesh(
            new THREE.TorusGeometry(0.14, 0.03, 8, 20),
            new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
        );
        wheel3d.position.set(-0.32, 1.0, -1.0);
        wheel3d.rotation.x = Math.PI / 2;
        g.add(wheel3d);

        const woman1 = buildWoman(0x171110, 'long', 0x7a1420);   // тёмные волосы, красное платье
        woman1.position.set(-0.32, 0.05, -0.55);
        woman1.scale.setScalar(0.6);
        g.add(woman1);
        const woman2 = buildWoman(0x4a2c18, 'bun', 0x1e3a6b);   // каштановые, синее платье
        woman2.position.set(0.32, 0.05, -0.45);
        woman2.scale.setScalar(0.6);
        g.add(woman2);
        g.userData.occupants = [woman1, woman2];

        return g;
    }

    /* ---------- Экземпляры машин ---------- */
    const tiguanColor = 0xe6e8ea; // цвет с левого Tiguan на фото (белый/серебристый)
    const playerCar = buildTiguan(tiguanColor);
    playerCar.group.position.set(0, 0, 0);
    playerCar.group.rotation.y = Math.PI; // лицом к -z (по дороге)
    scene.add(playerCar.group);

    const enemyCar = buildCayenne();
    enemyCar.position.set(0, 0, CFG.START_GAP);
    enemyCar.rotation.y = Math.PI;
    scene.add(enemyCar);

    /* ---------- Актёры интро-сценки (вне машин) ---------- */
    const playerDriver = playerCar.group.userData.driver;
    const enemyOccupants = enemyCar.userData.occupants;

    const actorMan = buildMan();
    const actorWomanA = buildWoman(0x171110, 'long', 0x7a1420);  // тёмные волосы, красное платье
    const actorWomanB = buildWoman(0x4a2c18, 'bun', 0x1e3a6b);   // каштановые, синее платье
    const actors = [actorMan, actorWomanA, actorWomanB];
    actors.forEach(a => scene.add(a));

    // на стартовом экране показываем актёров снаружи, салон прячем
    playerDriver.visible = false;
    enemyOccupants.forEach(o => { o.visible = false; });

    /* ---------- Интро-сценка (анимация сюжета на старте) ---------- */
    const CUT = {
        T: 14,                              // длительность цикла, сек
        manHome: { x: 4.2, z: 1.3 },
        seat: { x: 0.32, y: 0.05, z: 0.5 }, // мировое сиденье водителя (при carZ=0)
        womanA: { x: 5.4, z: 2.6 },
        womanB: { x: 4.4, z: 3.4 }
    };

    function ease(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

    function updateCutscene(t) {
        const tt = t % CUT.T;

        // Женщины пристают к мужчине: машут рукой и слегка наклоняются
        [[actorWomanA, 0], [actorWomanB, 1]].forEach(([w, i]) => {
            const home = i === 0 ? CUT.womanA : CUT.womanB;
            w.position.set(home.x, 0, home.z);
            w.scale.setScalar(1);
            w.rotation.y = Math.atan2(CUT.manHome.x - home.x, CUT.manHome.z - home.z);
            w.rotation.z = 0;
            const wave = Math.sin(t * 4 + i * 1.7);
            const arm = w.userData.arms[0];
            arm.rotation.x = -0.7 + wave * 0.4;
            arm.rotation.z = 0.5 + wave * 0.2;
            w.rotation.z += wave * 0.05;
        });

        // Мужчина отмахивается правой рукой
        const waveOff = Math.sin(t * 5);
        actorMan.userData.arms[1].rotation.x = -0.6 + waveOff * 0.35;
        actorMan.userData.arms[0].rotation.z = 0.3;

        // Садится в машину (7..10), затем уезжает (10..14)
        const getIn = ease(clamp((tt - 7) / 3, 0, 1));
        const driving = ease(clamp((tt - 10) / 4, 0, 1));

        actorMan.position.set(
            THREE.MathUtils.lerp(CUT.manHome.x, CUT.seat.x, getIn),
            THREE.MathUtils.lerp(0, CUT.seat.y, getIn),
            THREE.MathUtils.lerp(CUT.manHome.z, CUT.seat.z, getIn)
        );
        actorMan.scale.setScalar(THREE.MathUtils.lerp(1, 0.62, getIn));
        actorMan.rotation.y = Math.PI;
        actorMan.visible = getIn < 0.85;
        playerDriver.visible = getIn >= 0.85;

        // Tiguan трогается
        playerCar.group.position.z = -driving * 30;

        // Женщины делают шаг за машиной и поднимают руки
        actorWomanA.position.z = CUT.womanA.z + driving * 4;
        actorWomanB.position.z = CUT.womanB.z + driving * 4;
        if (driving > 0.3) {
            actorWomanA.userData.arms[0].rotation.x = -Math.PI * 0.5;
            actorWomanA.userData.arms[1].rotation.x = -Math.PI * 0.5;
            actorWomanB.userData.arms[0].rotation.x = -Math.PI * 0.5;
            actorWomanB.userData.arms[1].rotation.x = -Math.PI * 0.5;
        }
    }

    /* ---------- Игровое состояние ---------- */
    const state = {
        mode: 'menu',          // menu | playing | won | lost
        playerSpeed: 0,
        gap: CFG.START_GAP,
        playerZ: 0,
        totalDist: 0,
        time: 0,
        menuAngle: 0,
        shake: 0,
        camBack: 11
    };

    const chaseLook = new THREE.Vector3();
    let camPos = new THREE.Vector3(-12, 6, 10);
    let camLook = new THREE.Vector3(0, 1, 0);

    /* ---------- Управление ---------- */
    function pressSpace() {
        if (state.mode !== 'playing') return;
        state.playerSpeed = Math.min(state.playerSpeed + CFG.PLAYER_ACCEL_PER_PRESS, CFG.PLAYER_MAX_SPEED);
        state.shake = Math.min(state.shake + 0.5, 1);
    }
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            if (state.mode === 'menu' && !startLock) return;
            pressSpace();
        }
    });

    /* ---------- UI ---------- */
    function updateGauge() {
        const g = clamp(state.gap / CFG.GAP_MAX, 0, 1);
        const pct = (g * 100);
        barFill.style.width = (100 - pct) + '%';
        barPointer.style.left = pct + '%';
        const danger = g < 0.28 ? 1 : 0;
        vignette.style.opacity = danger ? (0.35 + (1 - g) * 0.65) : 0;
    }

    function showScreen(name) {
        screenStart.classList.add('hidden');
        screenWin.classList.add('hidden');
        screenLose.classList.add('hidden');
        if (name === 'start') screenStart.classList.remove('hidden');
        if (name === 'win') screenWin.classList.remove('hidden');
        if (name === 'lose') screenLose.classList.remove('hidden');
        hud.classList.toggle('hidden', name !== 'playing');
        speedHint.classList.toggle('hidden', name !== 'playing');
    }

    function startGame() {
        state.mode = 'playing';
        state.playerSpeed = 0;
        state.gap = CFG.START_GAP;
        state.playerZ = 0;
        state.totalDist = 0;
        state.time = 0;
        playerCar.group.position.z = 0;
        enemyCar.position.z = CFG.START_GAP;
        state.camBack = 11;
        camPos.set(2.2, 6.0, 11);
        camLook.set(0, 1.4, -16);
        // актёры интро прячутся, водитель/пассажирки появляются в салонах
        actors.forEach(a => { a.visible = false; });
        playerDriver.visible = true;
        enemyOccupants.forEach(o => { o.visible = true; });
        showScreen('playing');
    }

    function endGame(won) {
        state.mode = won ? 'won' : 'lost';
        showScreen(won ? 'win' : 'lose');
    }

    btnStart.addEventListener('click', startGame);
    btnRestart.addEventListener('click', startGame);
    btnRetry.addEventListener('click', startGame);

    let startLock = false;
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && state.mode === 'menu' && !startLock) {
            startLock = true;
            setTimeout(() => { startLock = false; }, 400);
            startGame();
        }
    });

    /* ---------- Обновление мира ---------- */
    function scrollScenery() {
        // объекты, оставшиеся позади камеры, перебрасываем далеко вперёд,
        // сохраняя "ленту" окружения относительно игрока
        const behind = state.playerZ + 120;
        const span = 2000;
        for (const s of scenery) {
            if (s.group.position.z > behind) {
                s.group.position.z -= span;
            }
        }
    }

    /* ---------- Основной цикл ---------- */
    let lastTime = performance.now();

    function animate(now) {
        requestAnimationFrame(animate);
        let dt = (now - lastTime) / 1000;
        lastTime = now;
        dt = Math.min(dt, 0.05);

        if (state.mode === 'menu') {
            state.menuAngle += dt;
            updateCutscene(state.menuAngle);

            // Камера интро: персонажи справа у Tiguan, управление слева
            const driving = ease(clamp((state.menuAngle % CUT.T - 10) / 4, 0, 1));
            const drift = Math.sin(state.menuAngle * 0.5) * 0.2;
            camPos.set(
                7.6 + driving * 2.5 + drift,
                2.1 + driving * 0.2,
                3.4 + driving * 3.5
            );
            camLook.set(3.8 - driving * 4, 1.15, 1.4 - driving * 4);

            // машины стоят на своих местах
            enemyCar.position.z = CFG.START_GAP;
            playerCar.group.rotation.y = Math.PI;
            enemyCar.rotation.y = Math.PI;
            camera.position.copy(camPos);
            camera.lookAt(camLook);
            renderer.render(scene, camera);
            updateGauge();
            return;
        }

        if (state.mode === 'playing') {
            state.time += dt;
            state.totalDist += state.playerSpeed * dt;

            // физика игрока
            state.playerSpeed *= Math.pow(CFG.PLAYER_DECAY_PER_SEC, dt);
            state.playerZ -= state.playerSpeed * dt;

            // Porsche преследует
            const enemySpeed = CFG.ENEMY_BASE + CFG.ENEMY_FACTOR * state.playerSpeed;
            state.gap += (state.playerSpeed - enemySpeed) * dt;
            state.gap = clamp(state.gap, 0.5, CFG.GAP_MAX);

            // позиции
            playerCar.group.position.z = state.playerZ;
            enemyCar.position.z = state.playerZ + state.gap;

            // крутим колёса
            const spin = state.playerSpeed * dt * 3;
            for (const w of wheelSpinGroups) w.rotation.x += spin;

            // прокрутка окружения
            scrollScenery();

            // камера от третьего лица с эффектом скорости
            const sp = state.playerSpeed;
            const fov = 62 + (sp / CFG.PLAYER_MAX_SPEED) * 14;
            camera.fov += (fov - camera.fov) * Math.min(1, dt * 6);
            camera.updateProjectionMatrix();

            state.shake = Math.max(0, state.shake - dt * 1.6);
            const sh = state.shake * sp * 0.012;
            const shakeX = Math.sin(state.time * 40) * sh;
            const shakeY = Math.cos(state.time * 33) * sh * 0.6;

            // Когда Porsche близко — камера отъезжает назад за него,
            // чтобы преследователь был виден и рос в кадре. Когда игрок
            // отрывается — камера возвращается ближе к Tiguan.
            const targetBack = state.gap < 24 ? (state.gap + 10) : 11;
            state.camBack += (targetBack - state.camBack) * Math.min(1, dt * 4);

            const desired = new THREE.Vector3(2.2 + shakeX, 6.0 + shakeY, state.playerZ + state.camBack);
            camPos.lerp(desired, Math.min(1, dt * 5));
            const lookAt = new THREE.Vector3(0, 1.4, state.playerZ - 16);
            chaseLook.lerp(lookAt, Math.min(1, dt * 5));
            camera.position.copy(camPos);
            camera.lookAt(chaseLook);

            // свет следует за машиной
            sun.position.set(state.playerZ + 60, 100, state.playerZ + 40);
            sun.target.position.set(state.playerZ, 0, state.playerZ - 20);
            sun.target.updateMatrixWorld();

            // победа/поражение
            if (state.gap >= CFG.WIN_GAP) endGame(true);
            else if (state.gap <= CFG.LOSE_GAP) endGame(false);
        } else {
            // завершённые состояния: лёгкое затухание движения
            state.playerSpeed *= Math.pow(0.3, dt);
            camPos.lerp(new THREE.Vector3(2.4, 5.4, 9).add(new THREE.Vector3(0, 0, state.playerZ)), Math.min(1, dt * 3));
            camera.position.copy(camPos);
            camera.lookAt(new THREE.Vector3(-2, 1.6, state.playerZ - 20));
        }

        updateGauge();
        renderer.render(scene, camera);
    }

    /* ---------- Ресайз ---------- */
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    showScreen('start');
    updateGauge();
    requestAnimationFrame(animate);
})();