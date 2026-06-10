(function () {
    var wrap = document.getElementById('cellWrap');
    var cell = document.getElementById('heroCell');
    if (!wrap || !cell || typeof THREE === 'undefined') return;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);

    var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    cell.appendChild(renderer.domElement);

    var w = 0, h = 0;
    var DEG = Math.PI / 180;
    // Uniform horizontal/vertical sprawl applied to cells and vessels (keeps topology)
    var SPRAWL = 1.12;

    function fitCamera() {
        var aspect = w / h || 1;
        camera.aspect = aspect;
        // Keep generous room so no cell reaches the canvas edge
        var halfWidthNeeded = 3.25;
        var halfHeightNeeded = Math.max(halfWidthNeeded / aspect, 2.3);
        camera.position.z = halfHeightNeeded / Math.tan(22.5 * DEG);
        camera.updateProjectionMatrix();
    }

    function resize() {
        var rect = wrap.getBoundingClientRect();
        w = rect.width;
        h = rect.height;
        renderer.setSize(w, h);
        fitCamera();
    }

    var ambientLight = new THREE.AmbientLight(0xffffff, 1.25);
    scene.add(ambientLight);
    var keyLight = new THREE.DirectionalLight(0x9fd0ff, 0.6);
    keyLight.position.set(2, 3, 4);
    scene.add(keyLight);

    var cluster = new THREE.Group();
    scene.add(cluster);

    function noise(x, y, z) {
        return Math.sin(x * 2.5) * Math.cos(y * 2.5) * Math.sin(z * 2.5);
    }

    // Cell populations that make up a tumor microenvironment.
    // Tumor cells form a dense core; immune cells infiltrate outward to the sides.
    var populations = [
        { name: 'tumor',      count: 12, rMin: 0.28, rMax: 0.44, color: 0x1b365d, emissive: 0x2db5a8, opacity: 0.15, radial: [0.0, 0.95], spread: { x: 1.7, y: 1.45, z: 0.4 } },
        { name: 'tumor-blue', count: 6, rMin: 0.26, rMax: 0.38, color: 0x2850aa, emissive: 0x4aa3ff, opacity: 0.16, radial: [0.1, 1.0], spread: { x: 1.8, y: 1.5, z: 0.4 } },
        { name: 'tcell',      count: 18, rMin: 0.15, rMax: 0.22, color: 0x1d6f6a, emissive: 0x2dd4bf, opacity: 0.28, radial: [0.15, 1.05], spread: { x: 2.0, y: 1.6, z: 0.5 } },
        { name: 'macrophage', count: 9,  rMin: 0.19, rMax: 0.27, color: 0x5b3aa6, emissive: 0x9b6cff, opacity: 0.26, radial: [0.12, 1.0], spread: { x: 1.9, y: 1.55, z: 0.5 } },
        { name: 'nk',         count: 7,  rMin: 0.14, rMax: 0.20, color: 0x2f7d52, emissive: 0x3ddc84, opacity: 0.28, radial: [0.18, 1.05], spread: { x: 1.95, y: 1.55, z: 0.5 } }
    ];

    var placed = [];
    var cells = [];

    function tryPlace(pop) {
        for (var attempt = 0; attempt < 90; attempt++) {
            var rad = pop.radial[0] + Math.random() * (pop.radial[1] - pop.radial[0]);
            var theta = Math.random() * Math.PI * 2;
            var phi = Math.acos(2 * Math.random() - 1);
            var x = rad * Math.sin(phi) * Math.cos(theta) * pop.spread.x * SPRAWL;
            var y = rad * Math.sin(phi) * Math.sin(theta) * pop.spread.y * SPRAWL;
            var z = rad * Math.cos(phi) * pop.spread.z;
            var r = pop.rMin + Math.random() * (pop.rMax - pop.rMin);
            var ok = true;
            for (var i = 0; i < placed.length; i++) {
                var dx = x - placed[i].x, dy = y - placed[i].y, dz = z - placed[i].z;
                var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist < 0.82 * (r + placed[i].r)) { ok = false; break; }
            }
            if (ok) { placed.push({ x: x, y: y, z: z, r: r }); return { x: x, y: y, z: z, r: r }; }
        }
        return null;
    }

    populations.forEach(function (pop) {
        for (var c = 0; c < pop.count; c++) {
            var spec = tryPlace(pop);
            if (!spec) continue;

            var detail = spec.r > 0.3 ? 2 : 1;
            var geometry = new THREE.IcosahedronGeometry(spec.r, detail);

            var positionAttribute = geometry.attributes.position;
            var v = new THREE.Vector3();
            var original = [];
            for (var i = 0; i < positionAttribute.count; i++) {
                v.fromBufferAttribute(positionAttribute, i);
                original.push(v.clone());
            }

            var membraneMat = new THREE.MeshPhysicalMaterial({
                color: pop.color,
                emissive: pop.emissive,
                emissiveIntensity: 0.14 + Math.random() * 0.1,
                roughness: 0.15,
                metalness: 0.1,
                clearcoat: 0.7,
                clearcoatRoughness: 0.25,
                transparent: true,
                opacity: pop.opacity + Math.random() * 0.06,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            var membrane = new THREE.Mesh(geometry, membraneMat);

            var wireMat = new THREE.MeshBasicMaterial({
                color: pop.color,
                wireframe: true,
                transparent: true,
                opacity: 0.14,
                depthWrite: false
            });
            var wire = new THREE.Mesh(geometry, wireMat);
            // Sit the wireframe just outside the membrane so the two surfaces don't z-fight
            wire.scale.setScalar(1.015);

            var nucleusColor = new THREE.Color(pop.color).lerp(new THREE.Color(0xffffff), 0.5);
            var nucleusMat = new THREE.MeshPhysicalMaterial({
                color: nucleusColor,
                emissive: pop.emissive,
                emissiveIntensity: 0.18,
                roughness: 0.3,
                transparent: true,
                opacity: 0.4,
                depthWrite: false
            });
            var nucleus = new THREE.Mesh(new THREE.IcosahedronGeometry(spec.r * 0.4, 1), nucleusMat);

            var cellGroup = new THREE.Group();
            cellGroup.add(membrane);
            cellGroup.add(wire);
            cellGroup.add(nucleus);
            cellGroup.position.set(spec.x, spec.y, spec.z);
            cluster.add(cellGroup);

            cells.push({
                geometry: geometry,
                original: original,
                phase: Math.random() * Math.PI * 2
            });
        }
    });

    // Vasculature network running through the microenvironment
    function addVessel(points, radius) {
        var curve = new THREE.CatmullRomCurve3(points.map(function (p) {
            return new THREE.Vector3(p[0] * SPRAWL, p[1] * SPRAWL, p[2]);
        }));
        var geo = new THREE.TubeGeometry(curve, 90, radius, 10, false);
        var mat = new THREE.MeshPhysicalMaterial({
            color: 0xb5495b,
            emissive: 0x3a0d16,
            emissiveIntensity: 0.2,
            roughness: 0.4,
            transparent: true,
            opacity: 0.42,
            side: THREE.DoubleSide
        });
        cluster.add(new THREE.Mesh(geo, mat));
    }

    var vessels = [
        // main vessel sweeping left to right within the slice plane
        { r: 0.018, pts: [[-2.7, -0.35, -0.18], [-1.5, 0.3, 0.12], [-0.3, -0.2, -0.1], [1.0, 0.35, 0.15], [2.0, -0.05, -0.1], [2.7, 0.35, 0.05]] },
        // crossing vessel reaching higher and lower
        { r: 0.014, pts: [[-2.3, 0.7, 0.2], [-0.9, -0.35, -0.15], [0.5, 0.3, -0.2], [2.1, -0.5, 0.15]] },
        // branch climbing up off the core
        { r: 0.011, pts: [[-0.3, -0.2, -0.1], [0.05, 0.6, 0.03], [0.3, 1.35, 0.1]] },
        // branch dropping down
        { r: 0.011, pts: [[1.0, 0.35, 0.15], [1.05, -0.5, 0.05], [0.8, -1.3, -0.05]] },
        // thin capillary near the core
        { r: 0.008, pts: [[-1.1, -0.7, 0.1], [-0.2, -0.25, 0.0], [0.7, -0.6, -0.1], [1.6, -0.25, 0.1]] }
    ];

    var SHOW_VESSELS = false;
    if (SHOW_VESSELS) {
        vessels.forEach(function (v) { addVessel(v.pts, v.r); });
    }

    var time = 0;
    var hovering = false;
    var targetRotX = 0.12;
    var targetRotY = 0;
    var currentRotX = 0.12;
    var currentRotY = 0;

    var lastT = performance.now();

    function render(now) {
        now = now || performance.now();
        // Frames elapsed since last render, normalised to 60fps and clamped so
        // a stalled tab or slow frame can't make the motion jump.
        var dt = Math.min((now - lastT) / 16.667, 3);
        lastT = now;

        time += 0.012 * dt;

        cells.forEach(function (c) {
            var pos = c.geometry.attributes.position;
            for (var i = 0; i < pos.count; i++) {
                var v = c.original[i];
                var n = noise(v.x + time * 0.35 + c.phase, v.y + time * 0.25 + c.phase, v.z + time * 0.3);
                var d = 1 + n * 0.02;
                pos.setXYZ(i, v.x * d, v.y * d, v.z * d);
            }
            pos.needsUpdate = true;
        });

        if (!hovering) {
            targetRotY += 0.0035 * dt;
        }

        // Frame-rate independent easing toward the target rotation
        var ease = 1 - Math.pow(1 - 0.08, dt);
        currentRotX += (targetRotX - currentRotX) * ease;
        currentRotY += (targetRotY - currentRotY) * ease;

        cluster.rotation.x = currentRotX;
        cluster.rotation.y = currentRotY;

        var breathe = 1 + Math.sin(time * 0.8) * 0.018;
        cluster.scale.set(breathe, breathe, breathe);

        renderer.render(scene, camera);
        requestAnimationFrame(render);
    }

    var wrapRect = null;

    wrap.addEventListener('mouseenter', function () {
        hovering = true;
        wrapRect = wrap.getBoundingClientRect();
    });

    window.addEventListener('scroll', function () { if (hovering) wrapRect = wrap.getBoundingClientRect(); }, { passive: true });
    window.addEventListener('resize', function () {
        resize();
        if (hovering) wrapRect = wrap.getBoundingClientRect();
    }, { passive: true });

    wrap.addEventListener('mousemove', function (e) {
        if (!hovering || !wrapRect) return;
        var mx = (e.clientX - wrapRect.left) / wrapRect.width - 0.5;
        var my = (e.clientY - wrapRect.top) / wrapRect.height - 0.5;
        targetRotY = mx * Math.PI * 0.8;
        targetRotX = 0.12 + my * Math.PI * 0.45;
    });

    wrap.addEventListener('mouseleave', function () {
        hovering = false;
        targetRotX = currentRotX;
        targetRotY = currentRotY;
    });

    resize();
    setTimeout(function () {
        requestAnimationFrame(render);
    }, 100);
})();
