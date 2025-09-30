document.addEventListener('DOMContentLoaded', () => {
    const easterEgg = document.getElementById('easterEgg');
    
    // Firefly System - only on pages with #particleBackground present
    const particleBackground = document.getElementById('particleBackground');
    if (particleBackground) {
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
            
            logo.style.filter = `drop-shadow(${x/10}px ${y/10}px 20px rgba(74, 158, 255, 0.3))`;
        });
        
        logo.addEventListener('mouseleave', () => {
            logo.style.filter = 'brightness(1.1)';
        });
    }

    // Switch visual demo: highlight cell states based on TF selection
    if (document.body.classList.contains('blog-page')) {
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
                // add arrowhead marker definition
                const ns = 'http://www.w3.org/2000/svg';
                const defs = document.createElementNS(ns, 'defs');
                const marker = document.createElementNS(ns, 'marker');
                marker.setAttribute('id', 'wireArrow');
                marker.setAttribute('viewBox', '0 0 14 14');
                marker.setAttribute('refX', '12');
                marker.setAttribute('refY', '7');
                marker.setAttribute('markerWidth', '14');
                marker.setAttribute('markerHeight', '14');
                marker.setAttribute('markerUnits', 'userSpaceOnUse');
                marker.setAttribute('orient', 'auto');
                const mpath = document.createElementNS(ns, 'path');
                mpath.setAttribute('d', 'M 0 0 L 14 7 L 0 14 z');
                mpath.setAttribute('fill', '#0F3460');
                mpath.setAttribute('opacity', '0.8');
                marker.appendChild(mpath);
                defs.appendChild(marker);
                svg.appendChild(defs);
                const bodyRect = visualBody.getBoundingClientRect();
                const fromRect = fromEl.getBoundingClientRect();
                const x1 = fromRect.left + fromRect.width / 2 - bodyRect.left;
                const y1 = fromRect.top + fromRect.height / 2 - bodyRect.top;
                const activeStates = new Set(mapping[tf] || []);
                nodes.forEach(node => {
                    const state = node.getAttribute('data-state');
                    if (!activeStates.has(state)) return;
                    const toRect = node.getBoundingClientRect();
                    const x2 = toRect.left + toRect.width / 2 - bodyRect.left;
                    const y2 = toRect.top + toRect.height / 2 - bodyRect.top;
                    const cx1 = x1 + (x2 - x1) * 0.35;
                    const cy1 = y1;
                    const cx2 = x1 + (x2 - x1) * 0.65;
                    const cy2 = y2;
                    const path = document.createElementNS(ns, 'path');
                    const d = `M ${x1},${y1} C ${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`;
                    path.setAttribute('d', d);
                    path.setAttribute('class', 'wire-path');
                    path.setAttribute('marker-end', 'url(#wireArrow)');
                    path.setAttribute('stroke-linecap', 'round');
                    svg.appendChild(path);
                    // animate draw and fade
                    try {
                        const len = path.getTotalLength();
                        path.style.strokeDasharray = String(len);
                        path.style.strokeDashoffset = String(len);
                        path.style.opacity = '0';
                        path.style.transition = 'stroke-dashoffset 1200ms ease, opacity 800ms ease';
                        requestAnimationFrame(() => {
                            path.style.strokeDashoffset = '0';
                            path.style.opacity = '1';
                        });
                        // hold briefly, then fade and remove
                        setTimeout(() => {
                            path.style.opacity = '0';
                            setTimeout(() => { if (path.parentNode) path.parentNode.removeChild(path); }, 900);
                        }, 1600);
                    } catch (_) {
                        // if getTotalLength not supported, just fade
                        path.style.transition = 'opacity 900ms ease';
                        path.style.opacity = '1';
                        setTimeout(() => {
                            path.style.opacity = '0';
                            setTimeout(() => { if (path.parentNode) path.parentNode.removeChild(path); }, 900);
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

    // Dial visual demo: single knob controlling activity across multiple gains
    if (document.body.classList.contains('blog-page')) {
        const dialEl = document.querySelector('.visual-dial');
        if (dialEl) {
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

            // Monotonic convex (quadratic-like) shapes with different saturation levels
            // y_i(x) ≈ amp[i] * x^{pow[i]}, giving convex curves that do NOT converge to the same max
            const amps = [0.70, 0.90, 1.00, 0.80];     // saturation levels for A,B,C,D
            const pows = [2.2, 2.0, 1.8, 2.4];         // convex exponents (>1)
            const shapes = amps.map((A, i) => (x) => Math.max(0, Math.min(1, A * Math.pow(x, pows[i]))));
            const colors = ['a','b','c','d'];

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
                yLabel.textContent = 'Enhancer activity';
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
                    const frac = Math.max(0, Math.min(1, val/100));
                    const start = -Math.PI; // 9 o'clock
                    const total = Math.PI * 2;
                    const stops = [
                        { f: 0.00, c: '#D6E3F3' },
                        { f: 0.33, c: '#6FA7D8' },
                        { f: 0.66, c: '#2E6FA8' },
                        { f: 1.00, c: '#0F3460' },
                    ];
                    let prevF = 0.0;
                    for (let i = 0; i < stops.length; i++) {
                        const segStartF = prevF;
                        const segEndF = Math.min(frac, stops[i].f);
                        if (segEndF > segStartF) {
                            const a1 = start + total * segStartF;
                            const a2 = start + total * segEndF;
                            dialCtx.beginPath();
                            dialCtx.lineWidth = ringW;
                            dialCtx.lineCap = (i === stops.length - 1 && segEndF === frac) ? 'round' : 'butt';
                            dialCtx.strokeStyle = stops[i].c;
                            dialCtx.arc(cx, cy, r, a1, a2);
                            dialCtx.stroke();
                        }
                        prevF = stops[i].f;
                        if (frac <= segEndF) break;
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
                    const cx = rect.left + rect.width/2;
                    const cy = rect.top + rect.height/2;
                    const px = (e.touches ? e.touches[0].clientX : e.clientX) - cx;
                    const py = (e.touches ? e.touches[0].clientY : e.clientY) - cy;
                    let ang = Math.atan2(py, px); // -PI..PI
                    let deg = ang * 180/Math.PI;  // -180..180
                    deg = (deg + 360) % 360;      // 0..360 (0 at 3 o'clock)
                    // normalize so 0 is at 9 o'clock
                    const degFromTop = (deg + 180) % 360; // 0..360 clockwise
                    return degFromTop;
                }
                let lastDeg = null;
                let currentVal = parseFloat(slider.value);
                function startDrag(e) {
                    dragging = true;
                    try { knob.setPointerCapture(e.pointerId); } catch(_) {}
                    document.addEventListener('pointermove', onDrag);
                    document.addEventListener('pointerup', endDrag);
                    e.preventDefault();
                    initialHandleAtTop = false;
                    const d = degFromEvent(e);
                    lastDeg = d;
                    currentVal = Math.max(0, Math.min(100, (d/360) * 100));
                    slider.value = String(currentVal);
                    update(currentVal);
                }
                function onDrag(e) {
                    if (!dragging) return;
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
                        currentVal = Math.max(0, Math.min(100, currentVal + (delta/360)*100));
                        lastDeg = d;
                        slider.value = String(currentVal);
                        update(currentVal);
                        rafPending = false;
                    });
                }
                function endDrag(e) {
                    dragging = false;
                    document.removeEventListener('pointermove', onDrag);
                    document.removeEventListener('pointerup', endDrag);
                    try { knob.releasePointerCapture(e.pointerId); } catch(_) {}
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
        }
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
