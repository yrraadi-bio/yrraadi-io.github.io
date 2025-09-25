document.addEventListener('DOMContentLoaded', () => {
    const easterEgg = document.getElementById('easterEgg');
    
    // Firefly System - magical glowing fireflies that blink and drift
    const particleBackground = document.getElementById('particleBackground');
    const fireflies = [];
    
    // Create fireflies
    function createFireflies() {
        const fireflyCount = 20;
        
        for (let i = 0; i < fireflyCount; i++) {
            createSingleFirefly();
        }
    }
    
    function createSingleFirefly() {
        const firefly = document.createElement('div');
        firefly.className = 'firefly';
        
        // Random blue shade
        const blueShades = ['light-blue', 'medium-blue', 'dark-blue'];
        const randomShade = blueShades[Math.floor(Math.random() * blueShades.length)];
        firefly.classList.add(randomShade);
        
        // Random position
        const x = Math.random() * window.innerWidth;
        const y = Math.random() * window.innerHeight;
        
        firefly.style.left = x + 'px';
        firefly.style.top = y + 'px';
        
        // Random animation delay for natural effect
        firefly.style.animationDelay = Math.random() * 3 + 's';
        
        // Store firefly data
        const fireflyData = {
            element: firefly,
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 0.3, // Slower, more gentle movement
            vy: (Math.random() - 0.5) * 0.3,
            visible: true,
            blinkState: 'normal',
            color: randomShade
        };
        
        fireflies.push(fireflyData);
        particleBackground.appendChild(firefly);
        
        // Animate firefly
        animateFirefly(fireflyData);
        
        // Random blinking behavior
        scheduleFireflyBlinks(fireflyData);
    }
    
    // Animate firefly floating (gentle, organic movement)
    function animateFirefly(fireflyData) {
        function move() {
            if (fireflyData.visible) {
                // Add some randomness to movement for organic feel
                fireflyData.vx += (Math.random() - 0.5) * 0.02;
                fireflyData.vy += (Math.random() - 0.5) * 0.02;
                
                // Limit velocity
                fireflyData.vx = Math.max(-0.5, Math.min(0.5, fireflyData.vx));
                fireflyData.vy = Math.max(-0.5, Math.min(0.5, fireflyData.vy));
                
                fireflyData.x += fireflyData.vx;
                fireflyData.y += fireflyData.vy;
                
                // Gentle bounce off edges
                if (fireflyData.x <= 0 || fireflyData.x >= window.innerWidth) {
                    fireflyData.vx *= -0.8;
                }
                if (fireflyData.y <= 0 || fireflyData.y >= window.innerHeight) {
                    fireflyData.vy *= -0.8;
                }
                
                // Keep in bounds
                fireflyData.x = Math.max(0, Math.min(window.innerWidth, fireflyData.x));
                fireflyData.y = Math.max(0, Math.min(window.innerHeight, fireflyData.y));
                
                fireflyData.element.style.left = fireflyData.x + 'px';
                fireflyData.element.style.top = fireflyData.y + 'px';
            }
            
            requestAnimationFrame(move);
        }
        move();
    }
    
    // Schedule random blinking patterns
    function scheduleFireflyBlinks(fireflyData) {
        function randomBlink() {
            if (!fireflyData.visible) return;
            
            const blinkType = Math.random();
            
            if (blinkType < 0.3) {
                // Bright flash
                fireflyData.element.classList.add('bright');
                setTimeout(() => {
                    fireflyData.element.classList.remove('bright');
                }, 800);
            } else if (blinkType < 0.6) {
                // Dim out
                fireflyData.element.classList.add('dim');
                setTimeout(() => {
                    fireflyData.element.classList.remove('dim');
                }, 1200);
            } else if (blinkType < 0.8) {
                // Quick double blink
                fireflyData.element.classList.add('bright');
                setTimeout(() => {
                    fireflyData.element.classList.remove('bright');
                    setTimeout(() => {
                        fireflyData.element.classList.add('bright');
                        setTimeout(() => {
                            fireflyData.element.classList.remove('bright');
                        }, 300);
                    }, 200);
                }, 300);
            } else {
                // Disappear and reappear elsewhere (like real fireflies)
                disappearFirefly(fireflyData);
                setTimeout(() => {
                    reappearFirefly(fireflyData);
                }, Math.random() * 3000 + 1000);
            }
            
            // Schedule next blink
            setTimeout(randomBlink, Math.random() * 4000 + 2000);
        }
        
        // Start with random delay
        setTimeout(randomBlink, Math.random() * 2000);
    }
    
    // Make firefly disappear
    function disappearFirefly(fireflyData) {
        fireflyData.visible = false;
        fireflyData.element.style.opacity = '0';
        fireflyData.element.style.transform = 'scale(0)';
    }
    
    // Make firefly reappear in new location
    function reappearFirefly(fireflyData) {
        // New random position
        fireflyData.x = Math.random() * window.innerWidth;
        fireflyData.y = Math.random() * window.innerHeight;
        fireflyData.element.style.left = fireflyData.x + 'px';
        fireflyData.element.style.top = fireflyData.y + 'px';
        
        // New random velocity
        fireflyData.vx = (Math.random() - 0.5) * 0.3;
        fireflyData.vy = (Math.random() - 0.5) * 0.3;
        
        // Fade back in
        fireflyData.visible = true;
        fireflyData.element.style.opacity = '1';
        fireflyData.element.style.transform = 'scale(1)';
    }
    
    // Initialize fireflies
    createFireflies();
    
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