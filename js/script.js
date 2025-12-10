document.addEventListener('DOMContentLoaded', () => {

    // --- Home Page DNA Animation ---
    const cellCanvas = document.getElementById('cellCanvas');
    if (cellCanvas) {
        const ctx = cellCanvas.getContext('2d');
        let width, height;
        let particles = [];
        let blobs = []; // Organic blobs
        let ripples = [];
        let angle = 0;
        let flowOffset = 0; // For the flowing movement

        // Colors
        const color1 = '#4A9EFF'; // Origin Blue
        const color2 = '#0f3462'; // Darker Blue

        function resize() {
            const container = cellCanvas.parentElement;
            width = container.offsetWidth;
            height = container.offsetHeight;
            const dpr = window.devicePixelRatio || 1;
            cellCanvas.width = width * dpr;
            cellCanvas.height = height * dpr;
            ctx.scale(dpr, dpr);
            cellCanvas.style.width = width + 'px';
            cellCanvas.style.height = height + 'px';

            initDNA();
        }

        function initDNA() {
            particles = [];
            blobs = [];

            // --- DNA Particles ---
            // Diagonal length is roughly sqrt(w^2 + h^2). 
            // We create a long buffer to ensure smooth scrolling.
            const totalLength = Math.sqrt(width * width + height * height) * 2.5;
            const particleCount = 160; // Denser

            for (let i = 0; i < particleCount; i++) {
                const progress = i / particleCount;
                const y = (progress * totalLength) - (totalLength / 2);

                particles.push({
                    relY: y,
                    angleOffset: progress * Math.PI * 12, // More twists
                    radius: 2 + Math.random() * 3,
                    baseRadius: 2 + Math.random() * 3,
                    pulseSpeed: 0.02 + Math.random() * 0.03,
                    pulseOffset: Math.random() * Math.PI * 2,
                    speed: 0.005 + Math.random() * 0.005
                });
            }

            // --- Floating Blobs (Proteins) ---
            // Grid-based distribution to ensure even coverage
            const cols = 0;
            const rows = 0; // Increased from 8 for 25% more proteins
            const cellW = (width * 0.55) / cols;
            const cellH = height / rows;

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    // Generate "Atom Cluster" structure
                    const atoms = [];
                    const atomCount = 3 + Math.floor(Math.random() * 4);
                    for (let j = 0; j < atomCount; j++) {
                        atoms.push({
                            offsetX: (Math.random() - 0.5) * 15,
                            offsetY: (Math.random() - 0.5) * 15,
                            r: 3 + Math.random() * 5
                        });
                    }

                    blobs.push({
                        // Place in grid cell with random jitter
                        x: (c * cellW) + (Math.random() * cellW),
                        y: (r * cellH) + (Math.random() * cellH),
                        atoms: atoms,
                        color: color1, // Strictly Light Blue
                        alpha: Math.random() * 0.5,
                        baseAlpha: 0.001 + Math.random() * 0.0, // Much lighter
                        alphaSpeed: 0.005 + Math.random() * 0.01,
                        alphaOffset: Math.random() * Math.PI * 2,
                        speedX: (Math.random() - 0.5) * 0.2,
                        speedY: (Math.random() - 0.5) * 0.2,
                        rotation: Math.random() * Math.PI * 2,
                        rotationSpeed: (Math.random() - 0.5) * 0.01
                    });
                }
            }
        }

        function update() {
            angle += 0.003;
            // flowOffset removed to stop linear movement

            const isMobile = window.innerWidth < 768;
            const splitRatio = window.innerWidth <= 1024 ? 0.5 : 0.55;
            const activeWidth = isMobile ? width : width * splitRatio;

            // Pulse DNA particles
            particles.forEach(p => {
                p.radius = p.baseRadius + Math.sin(angle * 2 + p.pulseOffset) * 1;
            });

            // Update Proteins
            blobs.forEach(b => {
                b.x += b.speedX;
                b.y += b.speedY;
                b.rotation += b.rotationSpeed;

                // Opacity Pulse
                b.alpha = b.baseAlpha + Math.sin(Date.now() * 0.001 * b.alphaSpeed + b.alphaOffset) * 0.15;
                if (b.alpha < 0) b.alpha = 0;
                if (b.alpha > 0.2) b.alpha = 0.2; // Much lighter cap

                // Bounce off edges
                if (b.x < -30) b.x = activeWidth + 30;
                if (b.x > activeWidth + 30) b.x = -30;
                if (b.y < -30) b.y = height + 30;
                if (b.y > height + 30) b.y = -30;
            });

            draw();
            requestAnimationFrame(update);
        }

        function draw() {
            ctx.clearRect(0, 0, width, height);

            const isMobile = window.innerWidth < 768;
            const splitRatio = window.innerWidth <= 1024 ? 0.5 : 0.55;
            const separatorX = isMobile ? width : width * splitRatio;
            const centerX = separatorX / 2;
            const centerY = height / 2;

            // Shared parameters
            const focalLength = 800;
            const rotAngle = -Math.PI / 5;
            const cosRot = Math.cos(rotAngle);
            const sinRot = Math.sin(rotAngle);
            // Total length no longer needed for wrapping, but used for initial setup

            // Clip everything to the left panel
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, separatorX, height);
            ctx.clip();

            // --- Draw Proteins (Background) ---
            blobs.forEach(b => {
                ctx.save();
                ctx.translate(b.x, b.y);
                ctx.rotate(b.rotation);

                ctx.fillStyle = b.color;
                ctx.globalAlpha = b.alpha;

                // Draw each "atom" in the cluster
                b.atoms.forEach(atom => {
                    ctx.beginPath();
                    ctx.arc(atom.offsetX, atom.offsetY, atom.r, 0, Math.PI * 2);
                    ctx.fill();
                });

                ctx.restore();
            });
            ctx.globalAlpha = 1.0;


            // Helper to draw one helix
            function drawHelix(offsetX, offsetY, scaleMult, alphaMult, radiusMult) {
                const helixRadius = 200 * radiusMult; // Increased from 160 for wider helix
                const renderPoints = [];
                const strand1Points = [];
                const strand2Points = [];

                particles.forEach(p => {
                    // No infinite scroll wrapping needed
                    let currentY = p.relY;

                    const theta = p.angleOffset + angle;

                    // --- Strand 1 ---
                    let x1 = Math.cos(theta) * helixRadius;
                    let y1 = currentY;
                    let z1 = Math.sin(theta) * helixRadius;

                    // Rotate
                    let rx1 = x1 * cosRot - y1 * sinRot;
                    let ry1 = x1 * sinRot + y1 * cosRot;

                    // Project with Offset
                    let scale1 = focalLength / (focalLength + z1);
                    
                    let px1, py1;
                    if (isMobile) {
                        // Horizontal: map spine (ry1) to X, radius (rx1) to Y
                        px1 = (centerX + offsetX) + ry1 * scale1 * scaleMult;
                        py1 = (centerY + offsetY) + rx1 * scale1 * scaleMult;
                    } else {
                        // Vertical: map radius (rx1) to X, spine (ry1) to Y
                        px1 = (centerX + offsetX) + rx1 * scale1 * scaleMult;
                        py1 = (centerY + offsetY) + ry1 * scale1 * scaleMult;
                    }

                    // Store spineY for sorting
                    const pt1 = { x: px1, y: py1, z: z1, scale: scale1 * scaleMult, color: color1, radius: p.radius, spineY: currentY };
                    renderPoints.push(pt1);
                    strand1Points.push(pt1);

                    // --- Strand 2 ---
                    let x2 = Math.cos(theta + Math.PI) * helixRadius;
                    let y2 = currentY;
                    let z2 = Math.sin(theta + Math.PI) * helixRadius;

                    let rx2 = x2 * cosRot - y2 * sinRot;
                    let ry2 = x2 * sinRot + y2 * cosRot;

                    let scale2 = focalLength / (focalLength + z2);
                    
                    let px2, py2;
                    if (isMobile) {
                        px2 = (centerX + offsetX) + ry2 * scale2 * scaleMult;
                        py2 = (centerY + offsetY) + rx2 * scale2 * scaleMult;
                    } else {
                        px2 = (centerX + offsetX) + rx2 * scale2 * scaleMult;
                        py2 = (centerY + offsetY) + ry2 * scale2 * scaleMult;
                    }

                    const pt2 = { x: px2, y: py2, z: z2, scale: scale2 * scaleMult, color: color2, radius: p.radius, spineY: currentY };
                    renderPoints.push(pt2);
                    strand2Points.push(pt2);

                    // Draw Connections (Base Pairs)
                    const distSq = (px1 - px2) ** 2 + (py1 - py2) ** 2;
                    if (scale1 > 0 && scale2 > 0 && distSq < 5000000 * scaleMult) {
                        ctx.beginPath();
                        ctx.moveTo(px1, py1);
                        ctx.lineTo(px2, py2);
                        ctx.lineWidth = 2 * scaleMult;
                        ctx.strokeStyle = `rgba(74, 158, 255, ${0.25 * ((scale1 + scale2) / 2) * alphaMult})`;
                        ctx.stroke();
                    }
                });

                // Draw Ribbon Strands
                function drawStrand(points, color) {
                    // Sort points by their position along the spine to ensure continuity
                    points.sort((a, b) => a.spineY - b.spineY);

                    ctx.beginPath();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 3 * scaleMult;
                    for (let i = 0; i < points.length - 1; i++) {
                        const p1 = points[i];
                        const p2 = points[i + 1];
                        const dx = p1.x - p2.x;
                        const dy = p1.y - p2.y;
                        if (dx * dx + dy * dy > 500000 * scaleMult) continue;

                        ctx.globalAlpha = Math.min(1, (p1.scale + p2.scale) / 2 * 0.5 * alphaMult);
                        ctx.beginPath();
                        ctx.moveTo(p1.x, p1.y);
                        ctx.lineTo(p2.x, p2.y);
                        ctx.stroke();
                    }
                    ctx.globalAlpha = 1.0;
                }

                drawStrand(strand1Points, color1);
                drawStrand(strand2Points, color2);

                // Draw Particles
                renderPoints.sort((a, b) => b.z - a.z);

                renderPoints.forEach(p => {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, Math.max(0, p.radius * p.scale), 0, Math.PI * 2);
                    ctx.fillStyle = p.color;
                    ctx.globalAlpha = Math.max(0.1, p.scale * 0.8 * alphaMult);
                    ctx.fill();
                    ctx.globalAlpha = 1.0;
                });
            }

            // Draw Main Helix Only
            drawHelix(0, 0, 1.0, 1.0, 1.0);

            ctx.restore(); // End clip

            // FORCE CLEAR RIGHT SIDE (Failsafe)
            if (!isMobile) {
            ctx.clearRect(separatorX, 0, width - separatorX, height);
            }
        }

        window.addEventListener('resize', resize);
        resize();

        // Create initial ripple in the center of the left panel
        const numRipples = 1; // Number of initial ripples
        for (let i = 0; i < numRipples; i++) {
            setTimeout(() => {
                const centerX = (width * 0.55) / 2; // Center of left panel
                const centerY = height / 2; // Center vertically
                ripples.push({
                    x: centerX,
                    y: centerY,
                    radius: 0,
                    maxRadius: 500 + Math.random() * 200, // Radius with randomness (500-700)
                    speed: 6 + Math.random() * 4, // Random speed (6-10)
                    active: true
                });
            }, 100 + i * 300); // Stagger each ripple by 300ms
        }

        update();
    }

    // --- Advisor Bio Popup Functionality ---
    const advisorBios = {
        kellis: {
            name: "Dr. Manolis Kellis",
            image: "assets/advisors/kellis.jpg", // You can replace with actual image path
            bio: "Dr. Manolis Kellis is a Professor of Computer Science at MIT and a member of the Broad Institute. He leads the MIT Computational Biology Group, which focuses on genomics, epigenomics, and regulatory genomics. His work has been instrumental in understanding the regulatory elements of the human genome and their role in disease."
        },
        paulk: {
            name: "Dr. Nicole Paulk",
            image: "assets/advisors/paulk.jpg", // You can replace with actual image path
            bio: "Dr. Nicole Paulk is the founder and CEO of Siren Biotechnology and an Assistant Professor, Affiliate at UCSF. She is a leading expert in AAV gene therapy and serves on the scientific advisory boards of Dyno Therapeutics, Astellas Gene Therapies, and Metagenomi, among other leading therapies in the gene and cell therapy space."
        },
        bashir: {
            name: "Dr. Rashid Bashir",
            image: "assets/advisors/bashir.jpg", // You can replace with actual image path
            bio: "Dr. Rashid Bashir is the Dean of The Grainger College of Engineering at the University of Illinois Urbana-Champaign and serves on the Executive Advisory Committee of the Chan Zuckerberg Biohub Chicago. He is a pioneer in bio-nanotechnology and bioengineering, with expertise in biosensors, microfluidics, and synthetic biology."
        }
    };

    const bioPopup = document.getElementById('advisorBioPopup');
    const bioName = document.getElementById('bioName');
    const bioText = document.getElementById('bioText');
    const bioImage = document.getElementById('bioImage');
    const bioClose = document.querySelector('.bio-close');
    const advisorNames = document.querySelectorAll('.advisor-name');

    function showBio(advisorKey) {
        const advisor = advisorBios[advisorKey];
        if (advisor) {
            bioName.textContent = advisor.name;
            bioText.textContent = advisor.bio;
            bioImage.src = advisor.image;
            bioImage.alt = advisor.name;
            bioPopup.classList.add('show');
        }
    }

    function closeBio() {
        bioPopup.classList.remove('show');
    }

    // Add click handlers to advisor names
    advisorNames.forEach(name => {
        name.addEventListener('click', () => {
            const advisorKey = name.getAttribute('data-advisor');
            showBio(advisorKey);
        });
    });

    // Close popup when clicking close button
    if (bioClose) {
        bioClose.addEventListener('click', closeBio);
    }

    // Close popup with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && bioPopup.classList.contains('show')) {
            closeBio();
        }
    });


    // --- Existing Logic for Blog Pages ---

    const easterEgg = document.getElementById('easterEgg');

    // Firefly System - only on pages with #particleBackground present
    const particleBackground = document.getElementById('particleBackground');
    if (particleBackground) {
        // ... (Keep existing firefly logic if needed, but minimalizing for now)
        // To be safe, we'll keep the code structure but it won't run on home page since we removed #particleBackground from index.html
        const fireflies = [];

        function createFireflies() {
            const fireflyCount = 20;
            for (let i = 0; i < fireflyCount; i++) {
                createSingleFirefly();
            }
        }

        function createSingleFirefly() {
            const firefly = document.createElement('div');
            firefly.className = 'firefly';

            const blueShades = ['light-blue', 'medium-blue', 'dark-blue'];
            const randomShade = blueShades[Math.floor(Math.random() * blueShades.length)];
            firefly.classList.add(randomShade);

            const x = Math.random() * window.innerWidth;
            const y = Math.random() * window.innerHeight;
            firefly.style.left = x + 'px';
            firefly.style.top = y + 'px';
            firefly.style.animationDelay = Math.random() * 3 + 's';

            const fireflyData = {
                element: firefly,
                x, y,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                visible: true,
                blinkState: 'normal',
                color: randomShade
            };
            fireflies.push(fireflyData);
            particleBackground.appendChild(firefly);
            animateFirefly(fireflyData);
            scheduleFireflyBlinks(fireflyData);
        }

        function animateFirefly(fireflyData) {
            function move() {
                if (fireflyData.visible) {
                    fireflyData.vx += (Math.random() - 0.5) * 0.02;
                    fireflyData.vy += (Math.random() - 0.5) * 0.02;
                    fireflyData.vx = Math.max(-0.5, Math.min(0.5, fireflyData.vx));
                    fireflyData.vy = Math.max(-0.5, Math.min(0.5, fireflyData.vy));
                    fireflyData.x += fireflyData.vx;
                    fireflyData.y += fireflyData.vy;
                    if (fireflyData.x <= 0 || fireflyData.x >= window.innerWidth) fireflyData.vx *= -0.8;
                    if (fireflyData.y <= 0 || fireflyData.y >= window.innerHeight) fireflyData.vy *= -0.8;
                    fireflyData.x = Math.max(0, Math.min(window.innerWidth, fireflyData.x));
                    fireflyData.y = Math.max(0, Math.min(window.innerHeight, fireflyData.y));
                    fireflyData.element.style.left = fireflyData.x + 'px';
                    fireflyData.element.style.top = fireflyData.y + 'px';
                }
                requestAnimationFrame(move);
            }
            move();
        }

        function scheduleFireflyBlinks(fireflyData) {
            function randomBlink() {
                if (!fireflyData.visible) return;
                const blinkType = Math.random();
                if (blinkType < 0.3) {
                    fireflyData.element.classList.add('bright');
                    setTimeout(() => fireflyData.element.classList.remove('bright'), 800);
                } else if (blinkType < 0.6) {
                    fireflyData.element.classList.add('dim');
                    setTimeout(() => fireflyData.element.classList.remove('dim'), 1200);
                } else if (blinkType < 0.8) {
                    fireflyData.element.classList.add('bright');
                    setTimeout(() => {
                        fireflyData.element.classList.remove('bright');
                        setTimeout(() => {
                            fireflyData.element.classList.add('bright');
                            setTimeout(() => fireflyData.element.classList.remove('bright'), 300);
                        }, 200);
                    }, 300);
                } else {
                    disappearFirefly(fireflyData);
                    setTimeout(() => reappearFirefly(fireflyData), Math.random() * 3000 + 1000);
                }
                setTimeout(randomBlink, Math.random() * 4000 + 2000);
            }
            setTimeout(randomBlink, Math.random() * 2000);
        }

        function disappearFirefly(fireflyData) {
            fireflyData.visible = false;
            fireflyData.element.style.opacity = '0';
            fireflyData.element.style.transform = 'scale(0)';
        }

        function reappearFirefly(fireflyData) {
            fireflyData.x = Math.random() * window.innerWidth;
            fireflyData.y = Math.random() * window.innerHeight;
            fireflyData.element.style.left = fireflyData.x + 'px';
            fireflyData.element.style.top = fireflyData.y + 'px';
            fireflyData.vx = (Math.random() - 0.5) * 0.3;
            fireflyData.vy = (Math.random() - 0.5) * 0.3;
            fireflyData.visible = true;
            fireflyData.element.style.opacity = '1';
            fireflyData.element.style.transform = 'scale(1)';
        }

        // Initialize fireflies only on pages with the container
        createFireflies();
    }

    // Easter Egg - Hidden message activation
    let clickCount = 0;
    const logo = document.querySelector('.header-logo');

    if (logo && easterEgg) {
        logo.addEventListener('click', (e) => {
            e.preventDefault();
            clickCount++;

            if (clickCount === 3) {
                easterEgg.classList.add('show');

                // Hide after 5 seconds
                setTimeout(() => {
                    easterEgg.classList.remove('show');
                    clickCount = 0;
                }, 5000);
            }
        });
    }

    // Smooth scroll reveal animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe elements for scroll animations
    const animateElements = document.querySelectorAll('.hero-subtitle, .molecular-container, .blog-molecular');
    animateElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'all 0.8s ease-out';
        observer.observe(el);
    });

    // DNA strand interactive effect
    const dnaStrands = document.querySelectorAll('.dna-strand');

    document.addEventListener('mousemove', (e) => {
        const mouseX = e.clientX / window.innerWidth;
        const mouseY = e.clientY / window.innerHeight;

        dnaStrands.forEach((strand, index) => {
            const intensity = (mouseX + mouseY) * 0.1;
            const delay = index * 0.1;

            strand.style.opacity = Math.min(0.15, 0.03 + intensity);
            strand.style.transform = `translateY(${mouseY * 10 - 5}px) rotate(${mouseX * 360}deg)`;
            strand.style.transitionDelay = `${delay}s`;
        });
    });

    // Typing effect for mystery text (optional enhancement)
    const mysteryText = document.querySelector('.mystery-text p');
    if (mysteryText) {
        const originalText = mysteryText.textContent;
        mysteryText.textContent = '';

        let i = 0;
        const typeWriter = () => {
            if (i < originalText.length) {
                mysteryText.textContent += originalText.charAt(i);
                i++;
                setTimeout(typeWriter, 50);
            }
        };

        // Start typing effect after page load
        setTimeout(typeWriter, 1500);
    }

    // Parallax effect for molecular elements
    window.addEventListener('scroll', () => {
        const scrolled = window.pageYOffset;
        const parallaxElements = document.querySelectorAll('.molecular-container, .blog-molecular');

        parallaxElements.forEach(element => {
            const speed = 0.5;
            element.style.transform = `translateY(${scrolled * speed}px)`;
        });
    });

    // Enhanced logo glow effect
    if (logo) {
        logo.addEventListener('mousemove', (e) => {
            const rect = logo.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            logo.style.filter = `drop-shadow(${x / 10}px ${y / 10}px 20px rgba(74, 158, 255, 0.3))`;
        });

        logo.addEventListener('mouseleave', () => {
            logo.style.filter = 'brightness(1.1)';
        });
    }

    if (document.body.classList.contains('blog-page')) {
        const motifCarousel = document.querySelector('.motif-carousel');
        if (motifCarousel) {
            const track = motifCarousel.querySelector('.motif-track');
            const slides = Array.from(track ? track.children : []);
            const prevBtn = motifCarousel.querySelector('.motif-prev');
            const nextBtn = motifCarousel.querySelector('.motif-next');
            const dotsWrap = motifCarousel.querySelector('.motif-dots');
            let current = 0;
            let slideWidth = slides[0]?.getBoundingClientRect().width || 0;

            function ensureDots() {
                if (!dotsWrap) return;
                dotsWrap.innerHTML = '';
                slides.forEach((slide, idx) => {
                    const dot = document.createElement('button');
                    dot.type = 'button';
                    const heading = slide.querySelector('h3');
                    dot.setAttribute('aria-label', heading ? heading.textContent : `Slide ${idx + 1}`);
                    dot.setAttribute('aria-selected', idx === current ? 'true' : 'false');
                    dot.addEventListener('click', () => goTo(idx));
                    dotsWrap.appendChild(dot);
                });
            }

            function updateControls() {
                if (prevBtn) prevBtn.disabled = current === 0;
                if (nextBtn) nextBtn.disabled = current === slides.length - 1;
                if (dotsWrap) {
                    Array.from(dotsWrap.children).forEach((dot, idx) => {
                        dot.setAttribute('aria-selected', idx === current ? 'true' : 'false');
                    });
                }
            }

            function applyTransform() {
                if (!track) return;
                const offset = -current * slideWidth;
                track.style.transform = `translateX(${offset}px)`;
            }

            function goTo(idx) {
                if (idx < 0 || idx >= slides.length) return;
                current = idx;
                updateControls();
                applyTransform();
            }

            function onResize() {
                if (!slides.length) return;
                slideWidth = slides[0].getBoundingClientRect().width;
                applyTransform();
            }

            if (slides.length > 0) {
                ensureDots();
                updateControls();
                onResize();
                window.addEventListener('resize', onResize);
                if (prevBtn) prevBtn.addEventListener('click', () => goTo(Math.max(0, current - 1)));
                if (nextBtn) nextBtn.addEventListener('click', () => goTo(Math.min(slides.length - 1, current + 1)));
            }
        }

        // Switch visual demo: highlight cell states based on TF selection
        const switchEl = document.querySelector('.visual-switch');
        if (switchEl) {
            const chips = Array.from(switchEl.querySelectorAll('.tf-chip'));
            const nodes = Array.from(switchEl.querySelectorAll('.cell-node'));
            const visualBody = switchEl.querySelector('.visual-body');
            let wiresSvg = null;
            const mapping = {
                'TF-1': ['Cell State A', 'Cell State D'],
                'TF-2': ['Cell State B'],
                'TF-3': ['Cell State C', 'Cell State F', 'Cell State H'],
                'TF-4': ['Cell State E', 'Cell State G'],
                'TF-5': ['Cell State A', 'Cell State E', 'Cell State H', 'Cell State D'],
                'TF-6': ['Cell State C', 'Cell State G']
            };

            function ensureWires() {
                if (!wiresSvg) {
                    wiresSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    wiresSvg.classList.add('wires');
                    visualBody.appendChild(wiresSvg);
                }
                return wiresSvg;
            }

            function drawWires(fromEl, tf) {
                const svg = ensureWires();
                // clear previous wires
                while (svg.firstChild) svg.removeChild(svg.firstChild);
                const ns = 'http://www.w3.org/2000/svg';
                const bodyRect = visualBody.getBoundingClientRect();
                const fromRect = fromEl.getBoundingClientRect();
                const x1 = fromRect.left + fromRect.width / 2 - bodyRect.left;
                const y1 = fromRect.top + fromRect.height / 2 - bodyRect.top;
                const activeStates = new Set(mapping[tf] || []);
                const findIntersection = (x1, y1, x2, y2, rect) => {
                    const minX = rect.left - bodyRect.left;
                    const maxX = rect.right - bodyRect.left;
                    const minY = rect.top - bodyRect.top;
                    const maxY = rect.bottom - bodyRect.top;
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    let t0 = 0;
                    let t1 = 1;
                    const clip = (p, q) => {
                        if (p === 0) {
                            return q >= 0;
                        }
                        const r = q / p;
                        if (p < 0) {
                            if (r > t1) return false;
                            if (r > t0) t0 = r;
                        } else {
                            if (r < t0) return false;
                            if (r < t1) t1 = r;
                        }
                        return true;
                    };
                    if (clip(-dx, x1 - minX) && clip(dx, maxX - x1) && clip(-dy, y1 - minY) && clip(dy, maxY - y1)) {
                        const entry = t0;
                        return {
                            x: x1 + dx * entry,
                            y: y1 + dy * entry
                        };
                    }
                    return { x: x2, y: y2 };
                };

                nodes.forEach(node => {
                    const state = node.getAttribute('data-state');
                    if (!activeStates.has(state)) return;
                    const toRect = node.getBoundingClientRect();
                    const x2 = toRect.left + toRect.width / 2 - bodyRect.left;
                    const y2 = toRect.top + toRect.height / 2 - bodyRect.top;
                    const cx1 = x1 + (x2 - x1) * 0.35;
                    const cy1 = y1;
                    const { x: hitX, y: hitY } = findIntersection(x1, y1, x2, y2, toRect);
                    const shrink = 1.5;
                    const vx = x2 - hitX;
                    const vy = y2 - hitY;
                    const vlen = Math.hypot(vx, vy) || 1;
                    const finalX = hitX - (vx / vlen) * shrink;
                    const finalY = hitY - (vy / vlen) * shrink;
                    const finalCx = x1 + (finalX - x1) * 0.65;
                    const finalCy = y1 + (finalY - y1) * 0.65;
                    const path = document.createElementNS(ns, 'path');
                    const d = `M ${x1},${y1} C ${cx1},${cy1} ${finalCx},${finalCy} ${finalX},${finalY}`;
                    path.setAttribute('d', d);
                    path.setAttribute('class', 'wire-path');
                    path.setAttribute('stroke-linecap', 'butt');
                    svg.appendChild(path);
                    // animate draw and fade
                    try {
                        const lenPath = path.getTotalLength();
                        path.style.strokeDasharray = String(lenPath);
                        path.style.strokeDashoffset = String(lenPath);
                        path.style.opacity = '0';
                        path.style.transition = 'stroke-dashoffset 1200ms ease, opacity 800ms ease';
                        requestAnimationFrame(() => {
                            path.style.strokeDashoffset = '0';
                            path.style.opacity = '1';
                        });
                        // hold briefly, then fade and remove
                        setTimeout(() => {
                            path.style.opacity = '0';
                            setTimeout(() => {
                                if (path.parentNode) path.parentNode.removeChild(path);
                            }, 900);
                        }, 1600);
                    } catch (_) {
                        // if getTotalLength not supported, just fade
                        path.style.transition = 'opacity 900ms ease';
                        path.style.opacity = '1';
                        setTimeout(() => {
                            path.style.opacity = '0';
                            setTimeout(() => {
                                if (path.parentNode) path.parentNode.removeChild(path);
                            }, 900);
                        }, 1200);
                    }
                });
            }

            function clearActive() {
                chips.forEach(c => c.setAttribute('aria-selected', 'false'));
                nodes.forEach(n => n.classList.remove('on'));
                if (wiresSvg) while (wiresSvg.firstChild) wiresSvg.removeChild(wiresSvg.firstChild);
            }

            function updateActive(tf, sourceEl) {
                chips.forEach(c => c.setAttribute('aria-selected', c.dataset.tf === tf ? 'true' : 'false'));
                nodes.forEach(n => {
                    const state = n.getAttribute('data-state');
                    const on = (mapping[tf] || []).includes(state);
                    n.classList.toggle('on', on);
                });
                if (sourceEl && tf) drawWires(sourceEl, tf);
            }

            chips.forEach(chip => {
                chip.addEventListener('click', () => {
                    const isSelected = chip.getAttribute('aria-selected') === 'true';
                    if (isSelected) {
                        clearActive();
                    } else {
                        updateActive(chip.dataset.tf, chip);
                    }
                });
                chip.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const isSelected = chip.getAttribute('aria-selected') === 'true';
                        if (isSelected) {
                            clearActive();
                        } else {
                            updateActive(chip.dataset.tf, chip);
                        }
                    }
                    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                        e.preventDefault();
                        const idx = chips.indexOf(chip);
                        const dir = e.key === 'ArrowRight' ? 1 : -1;
                        const next = (idx + dir + chips.length) % chips.length;
                        chips[next].focus();
                        updateActive(chips[next].dataset.tf, chips[next]);
                    }
                });
            });

            const selected = chips.find(c => c.getAttribute('aria-selected') === 'true');
            if (selected) updateActive(selected.dataset.tf, selected);
        }
    }

    // Dial visual demo(s): initialize all .visual-dial instances
    if (document.body.classList.contains('blog-page')) {
        const dialEls = document.querySelectorAll('.visual-dial');
        dialEls.forEach((dialEl) => {
            const slider = dialEl.querySelector('.dial-slider');
            const valueEl = dialEl.querySelector('.dial-value-num');
            const svg = dialEl.querySelector('.dial-chart');
            const knob = dialEl.querySelector('.dial-knob');
            const handle = dialEl.querySelector('.dial-handle');
            let ringRadius = null;
            const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
            // Canvas overlay to draw ring precisely in sync with handle
            const dialCanvas = document.createElement('canvas');
            dialCanvas.className = 'dial-canvas';
            // place canvas behind the handle
            if (knob.firstChild) {
                knob.insertBefore(dialCanvas, knob.firstChild);
            } else {
                knob.appendChild(dialCanvas);
            }
            const dialCtx = dialCanvas.getContext('2d');
            function resizeDialCanvas() {
                const size = knob.offsetWidth;
                const dpr = window.devicePixelRatio || 1;
                dialCanvas.width = size * dpr;
                dialCanvas.height = size * dpr;
                dialCanvas.style.width = size + 'px';
                dialCanvas.style.height = size + 'px';
                dialCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
            function computeRingRadius() {
                if (!knob) return 0;
                const kRect = knob.getBoundingClientRect();
                const track = dialEl.querySelector('.dial-track');
                const tRect = track ? track.getBoundingClientRect() : null;
                const knobRadius = kRect.width / 2;
                const borderW = parseFloat(getComputedStyle(knob).borderWidth) || 6;
                const outerVisualR = knobRadius - borderW / 2; // center of the border
                const innerR = tRect ? (tRect.width / 2) : (outerVisualR - 14); // track inset ~14px
                ringRadius = (outerVisualR + innerR) / 2;
                return ringRadius;
            }
            const W = 420, H = 240, padL = 40, padR = 16, padT = 16, padB = 32;
            svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

            const xToSvg = x => padL + x * (W - padL - padR);
            const yToSvg = y => H - padB - y * (H - padT - padB);

            // Choose curve shapes based on whether this is an inverted-U dial
            let shapes;
            const isPeak = dialEl.classList.contains('visual-peak');
            if (isPeak) {
                // Normalized Beta-like inverted-U (smooth arcs, start at 0,0, fall to 0 at 1)
                const betaParams = [
                    { a: 1.0, b: 1.8, A: 0.88 },
                    { a: 1.3, b: 1.3, A: 0.86 },
                    { a: 1.6, b: 1.1, A: 0.92 },
                    { a: 2.0, b: 0.9, A: 0.84 },
                ];
                shapes = betaParams.map(p => {
                    const c = Math.pow(p.a, p.a) * Math.pow(p.b, p.b) / Math.pow(p.a + p.b, p.a + p.b);
                    return (x) => {
                        const xx = Math.max(0, Math.min(1, x));
                        const base = Math.pow(xx, p.a) * Math.pow(1 - xx, p.b);
                        const y = (p.A * base) / c;
                        return Math.max(0, y);
                    };
                });
            } else {
                // Monotonic convex (quadratic-like) shapes with different saturation levels
                const amps = [0.42, 0.72, 1.00, 0.54];
                const pows = [2.6, 2.2, 1.5, 2.8];
                shapes = amps.map((A, i) => (x) => Math.max(0, Math.min(1, A * Math.pow(x, pows[i]))));
            }
            const colors = ['a', 'b', 'c', 'd'];

            function drawAxes() {
                const ns = 'http://www.w3.org/2000/svg';
                const axisX = document.createElementNS(ns, 'line');
                axisX.setAttribute('x1', padL);
                axisX.setAttribute('y1', yToSvg(0));
                axisX.setAttribute('x2', W - padR);
                axisX.setAttribute('y2', yToSvg(0));
                axisX.setAttribute('class', 'axis');
                svg.appendChild(axisX);

                const axisY = document.createElementNS(ns, 'line');
                axisY.setAttribute('x1', padL);
                axisY.setAttribute('y1', yToSvg(0));
                axisY.setAttribute('x2', padL);
                axisY.setAttribute('y2', yToSvg(1));
                axisY.setAttribute('class', 'axis');
                svg.appendChild(axisY);

                [0.5, 1].forEach(tx => {
                    const t = document.createElementNS(ns, 'line');
                    t.setAttribute('x1', xToSvg(tx));
                    t.setAttribute('y1', yToSvg(0));
                    t.setAttribute('x2', xToSvg(tx));
                    t.setAttribute('y2', yToSvg(0) + 6);
                    t.setAttribute('class', 'tick');
                    svg.appendChild(t);
                });
            }

            function linePathForIndex(idx) {
                const ns = 'http://www.w3.org/2000/svg';
                const path = document.createElementNS(ns, 'path');
                const pts = [];
                const N = 40;
                for (let i = 0; i <= N; i++) {
                    const x = i / N;
                    const y = Math.max(0, Math.min(1, shapes[idx](x)));
                    pts.push(`${i === 0 ? 'M' : 'L'} ${xToSvg(x)},${yToSvg(y)}`);
                }
                path.setAttribute('d', pts.join(' '));
                return path;
            }

            function createChart() {
                drawAxes();
                const ns = 'http://www.w3.org/2000/svg';
                // Y-axis label
                const yLabel = document.createElementNS(ns, 'text');
                const yLabelX = padL - 28;
                const yLabelY = H / 2;
                yLabel.textContent = 'Reporter activity';
                yLabel.setAttribute('fill', '#425975');
                yLabel.setAttribute('font-size', '12');
                yLabel.setAttribute('text-anchor', 'middle');
                yLabel.setAttribute('transform', `rotate(-90 ${yLabelX} ${yLabelY})`);
                yLabel.setAttribute('x', yLabelX);
                yLabel.setAttribute('y', yLabelY);
                svg.appendChild(yLabel);
                const curves = shapes.map((fn, idx) => {
                    const p = linePathForIndex(idx);
                    p.setAttribute('class', `curve curve-${colors[idx]}`);
                    svg.appendChild(p);
                    return p;
                });
                const cursor = document.createElementNS(ns, 'line');
                cursor.setAttribute('y1', padT);
                cursor.setAttribute('y2', H - padB);
                cursor.setAttribute('class', 'cursor-line');
                svg.appendChild(cursor);

                const markers = shapes.map((fn, idx) => {
                    const c = document.createElementNS(ns, 'circle');
                    c.setAttribute('r', 5);
                    c.setAttribute('class', `marker marker-${colors[idx]}`);
                    svg.appendChild(c);
                    return c;
                });

                // Optional activation threshold for inverted-U only
                let thrLine = null, thrText = null;
                if (isPeak) {
                    const threshold = 0.2;
                    thrLine = document.createElementNS(ns, 'line');
                    thrLine.setAttribute('x1', padL);
                    thrLine.setAttribute('x2', W - padR);
                    thrLine.setAttribute('y1', yToSvg(threshold));
                    thrLine.setAttribute('y2', yToSvg(threshold));
                    thrLine.setAttribute('class', 'threshold-line');
                    svg.appendChild(thrLine);
                    thrText = document.createElementNS(ns, 'text');
                    thrText.textContent = 'Activation Threshold';
                    thrText.setAttribute('class', 'threshold-label');
                    thrText.setAttribute('x', W - padR - 4);
                    thrText.setAttribute('y', yToSvg(threshold) - 6);
                    thrText.setAttribute('text-anchor', 'end');
                    svg.appendChild(thrText);
                }

                let initialHandleAtTop = false;

                function setKnobVisual(val) {
                    // Draw track + progress on canvas for perfect alignment
                    resizeDialCanvas();
                    const size = knob.offsetWidth;
                    const cx = size / 2, cy = size / 2;
                    const r = ringRadius != null ? ringRadius : computeRingRadius();
                    const ringW = 12;
                    // clear
                    dialCtx.clearRect(0, 0, dialCanvas.width, dialCanvas.height);
                    // track
                    dialCtx.beginPath();
                    dialCtx.lineWidth = ringW;
                    dialCtx.lineCap = 'butt';
                    dialCtx.strokeStyle = '#e6ecf5';
                    dialCtx.arc(cx, cy, r, 0, Math.PI * 2);
                    dialCtx.stroke();
                    // progress from 9 o'clock baseline with fixed per-angle colors
                    const frac = Math.max(0, Math.min(1, val / 100));
                    const start = -Math.PI; // 9 o'clock
                    const total = Math.PI * 2;
                    const bands = [
                        { limit: 0.33, color: '#6FA7D8' },
                        { limit: 0.66, color: '#2E6FA8' },
                        { limit: Infinity, color: '#0F3460' },
                    ];
                    let activeColor = bands[bands.length - 1].color;
                    for (let i = 0; i < bands.length; i++) {
                        if (frac < bands[i].limit - 1e-4) {
                            activeColor = bands[i].color;
                            break;
                        }
                    }
                    if (frac > 0) {
                        dialCtx.beginPath();
                        dialCtx.lineWidth = ringW;
                        dialCtx.lineCap = 'round';
                        dialCtx.strokeStyle = activeColor;
                        dialCtx.arc(cx, cy, r, start, start + total * frac, false);
                        dialCtx.stroke();
                    }
                    // handle at end
                    const deg = frac * 360;
                    const theta = deg - 180; // 9 o'clock baseline
                    if (handle) handle.style.transform = `rotate(${theta}deg) translate(${r}px) rotate(${-theta}deg)`;
                    knob.setAttribute('aria-valuenow', String(Math.round(val)));
                }

                function update(val) {
                    const x = Math.max(0, Math.min(1, val / 100));
                    if (valueEl) valueEl.textContent = Math.round(val);
                    cursor.setAttribute('x1', xToSvg(x));
                    cursor.setAttribute('x2', xToSvg(x));
                    markers.forEach((m, i) => {
                        const y = Math.max(0, Math.min(1, shapes[i](x)));
                        m.setAttribute('cx', xToSvg(x));
                        m.setAttribute('cy', yToSvg(y));
                    });
                    setKnobVisual(val);
                }

                // initialize from slider value
                computeRingRadius();
                resizeDialCanvas();
                update(parseFloat(slider.value));
                slider.addEventListener('input', () => { initialHandleAtTop = false; update(parseFloat(slider.value)); });
                window.addEventListener('resize', () => { computeRingRadius(); resizeDialCanvas(); update(parseFloat(slider.value)); });

                // pointer interactions on knob
                let dragging = false;
                let rafPending = false;
                function degFromEvent(e) {
                    const rect = knob.getBoundingClientRect();
                    const cx = rect.left + rect.width / 2;
                    const cy = rect.top + rect.height / 2;
                    const px = (e.touches ? e.touches[0].clientX : e.clientX) - cx;
                    const py = (e.touches ? e.touches[0].clientY : e.clientY) - cy;
                    let ang = Math.atan2(py, px); // -PI..PI
                    let deg = ang * 180 / Math.PI;  // -180..180
                    deg = (deg + 360) % 360;      // 0..360 (0 at 3 o'clock)
                    // normalize so 0 is at 9 o'clock
                    const degFromTop = (deg + 180) % 360; // 0..360 clockwise
                    return degFromTop;
                }
                let lastDeg = null;
                let currentVal = parseFloat(slider.value);
                function startDrag(e) {
                    dragging = true;
                    e.preventDefault();
                    try { knob.setPointerCapture(e.pointerId); } catch (_) { }
                    window.addEventListener('pointermove', onDrag, { passive: false });
                    window.addEventListener('pointerup', endDrag, { passive: true });
                    knob.addEventListener('pointercancel', endDrag, { passive: true });
                    initialHandleAtTop = false;
                    const d = degFromEvent(e);
                    lastDeg = d;
                    currentVal = Math.max(0, Math.min(100, (d / 360) * 100));
                    slider.value = String(currentVal);
                    update(currentVal);
                }
                function onDrag(e) {
                    if (!dragging) return;
                    if (e && e.preventDefault) e.preventDefault();
                    if (rafPending) return;
                    rafPending = true;
                    requestAnimationFrame(() => {
                        const d = degFromEvent(e);
                        if (lastDeg == null) lastDeg = d;
                        // compute shortest angular delta (-180..180)
                        let delta = d - lastDeg;
                        if (delta > 180) delta -= 360;
                        if (delta < -180) delta += 360;
                        // convert to value change and clamp (prevents wrap-around at 0/100)
                        currentVal = Math.max(0, Math.min(100, currentVal + (delta / 360) * 100));
                        lastDeg = d;
                        slider.value = String(currentVal);
                        update(currentVal);
                        rafPending = false;
                    });
                }
                function endDrag(e) {
                    dragging = false;
                    window.removeEventListener('pointermove', onDrag);
                    window.removeEventListener('pointerup', endDrag);
                    knob.removeEventListener('pointercancel', endDrag);
                    try { knob.releasePointerCapture(e.pointerId); } catch (_) { }
                }
                knob.addEventListener('pointerdown', startDrag);
                // keyboard on knob
                knob.addEventListener('keydown', (e) => {
                    let v = parseFloat(slider.value);
                    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { v = Math.min(100, v + 2); }
                    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { v = Math.max(0, v - 2); }
                    else if (e.key === 'Home') { v = 0; }
                    else if (e.key === 'End') { v = 100; }
                    else return;
                    e.preventDefault();
                    initialHandleAtTop = false;
                    slider.value = String(v);
                    update(v);
                });
            }

            createChart();
        });
    }

    // Removed Table of Contents generation (will add later)
});

// Additional Interactive Element Option 2: Particle System
class ParticleSystem {
    constructor() {
        this.particles = [];
        this.canvas = null;
        this.ctx = null;
        this.init();
    }

    init() {
        // Create canvas for particle system
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '-1';
        this.canvas.style.opacity = '0.1';

        document.body.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        this.resize();
        this.createParticles();
        this.animate();

        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    createParticles() {
        for (let i = 0; i < 50; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                size: Math.random() * 2 + 1,
                opacity: Math.random() * 0.5 + 0.1
            });
        }
    }

    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.particles.forEach(particle => {
            particle.x += particle.vx;
            particle.y += particle.vy;

            if (particle.x < 0 || particle.x > this.canvas.width) particle.vx *= -1;
            if (particle.y < 0 || particle.y > this.canvas.height) particle.vy *= -1;

            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(74, 158, 255, ${particle.opacity})`;
            this.ctx.fill();
        });

        requestAnimationFrame(() => this.animate());
    }
}

// Particle system disabled - using enhanced DNA animation instead
// new ParticleSystem();
