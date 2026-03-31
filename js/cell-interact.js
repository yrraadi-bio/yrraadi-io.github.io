(function () {
    var wrap = document.getElementById('cellWrap');
    var cell = document.getElementById('heroCell');
    if (!wrap || !cell || typeof THREE === 'undefined') return;

    // Set up Three.js scene
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.z = 4;

    var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    var cellSize = Math.min(wrap.offsetWidth, wrap.offsetHeight) || 400;
    renderer.setSize(cellSize, cellSize);
    renderer.setPixelRatio(window.devicePixelRatio);
    cell.appendChild(renderer.domElement);

    // Create a medium-res icosahedron for the blob (optimized for load time)
    var geometry = new THREE.IcosahedronGeometry(1.2, 16);
    
    // Save original vertices for noise calculation
    var positionAttribute = geometry.attributes.position;
    var vertex = new THREE.Vector3();
    var originalPositions = [];
    for (var i = 0; i < positionAttribute.count; i++) {
        vertex.fromBufferAttribute(positionAttribute, i);
        originalPositions.push(vertex.clone());
    }

    // Material: glossy, translucent, catching light
    var material = new THREE.MeshPhysicalMaterial({
        color: 0x1b365d,         // Origin navy base
        emissive: 0x2db5a8,      // Teal/green glow
        emissiveIntensity: 0.2,
        roughness: 0.1,
        metalness: 0.1,
        clearcoat: 0.8,
        clearcoatRoughness: 0.2,
        wireframe: true,         // Wireframe gives that tech/data look
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide
    });

    var blob = new THREE.Mesh(geometry, material);
    scene.add(blob);

    // Add a solid inner core (lower res since it's just a solid shape inside)
    var core = new THREE.Object3D();
    scene.add(core);

    // Lighting
    var ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    // Simple pseudo-random noise function for vertices
    function noise(x, y, z) {
        return Math.sin(x * 2.5) * Math.cos(y * 2.5) * Math.sin(z * 2.5);
    }

    var time = 0;
    var hovering = false;
    var targetRotX = 0;
    var targetRotY = 0;
    var currentRotX = 0;
    var currentRotY = 0;

    function render() {
        time += 0.02;

        // Animate vertices for the wavy effect
        var pos = blob.geometry.attributes.position;
        for (var i = 0; i < pos.count; i++) {
            var v = originalPositions[i];
            // Calculate noise based on original position and time
            var n = noise(v.x + time * 0.5, v.y + time * 0.3, v.z + time * 0.4);
            // Displace vertex along its normal (which is its position for a sphere centered at 0)
            var displacement = 1 + n * 0.15;
            pos.setXYZ(i, v.x * displacement, v.y * displacement, v.z * displacement);
        }
        pos.needsUpdate = true;
        
        // Skip computeVertexNormals for performance - wireframe/basic materials don't strictly need it every frame
        // blob.geometry.computeVertexNormals();

        // Auto rotation vs Hover rotation
        if (!hovering) {
            targetRotY += 0.005;
            targetRotX += 0.002;
        }

        // Increase interpolation speed for snappier, less laggy feel
        currentRotX += (targetRotX - currentRotX) * 0.08;
        currentRotY += (targetRotY - currentRotY) * 0.08;

        blob.rotation.x = currentRotX;
        blob.rotation.y = currentRotY;
        core.rotation.x = currentRotX * 0.5;
        core.rotation.y = currentRotY * 0.5;

        renderer.render(scene, camera);
        requestAnimationFrame(render);
    }

    // Cache bounding rect to avoid reflows on every mousemove
    var wrapRect = null;

    // Interaction
    wrap.addEventListener('mouseenter', function () {
        hovering = true;
        wrapRect = wrap.getBoundingClientRect();
    });

    // Update rect on scroll/resize just in case
    window.addEventListener('scroll', function() { if(hovering) wrapRect = wrap.getBoundingClientRect(); }, {passive: true});
    window.addEventListener('resize', function() { if(hovering) wrapRect = wrap.getBoundingClientRect(); }, {passive: true});

    wrap.addEventListener('mousemove', function (e) {
        if (!hovering || !wrapRect) return;
        var mx = (e.clientX - wrapRect.left) / wrapRect.width - 0.5;
        var my = (e.clientY - wrapRect.top) / wrapRect.height - 0.5;
        targetRotY = mx * Math.PI * 1.2;
        targetRotX = my * Math.PI * 1.2;
    });

    wrap.addEventListener('mouseleave', function () {
        hovering = false;
        // Reset targets to current so it doesn't snap back, just continues from where it is
        targetRotX = currentRotX;
        targetRotY = currentRotY;
    });

    // Delay start slightly to avoid blocking initial page render
    setTimeout(function() {
        requestAnimationFrame(render);
    }, 100);
})();
