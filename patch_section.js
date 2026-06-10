const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

const oldSection = `<svg viewBox="0 0 280 280" fill="none" class="dia dia-section">
                                <text x="140" y="16" text-anchor="middle" font-family="Inter,sans-serif" font-size="8" fill="rgba(27,54,93,0.35)" letter-spacing="2">SERIAL SECTIONS</text>
                                <g class="slab s0">
                                    <ellipse cx="72" cy="72" rx="48" ry="44" fill="rgba(27,54,93,0.06)" stroke="rgba(27,54,93,0.28)" stroke-width="1"/>
                                    <circle cx="58" cy="62" r="3.5" fill="rgba(27,54,93,0.18)"/><ellipse cx="80" cy="56" rx="4" ry="2.5" fill="rgba(27,54,93,0.22)" transform="rotate(-20 80 56)"/><path d="M65 78 L68 74 L72 79 L76 74 L78 79 L74 82 L70 82Z" fill="rgba(27,54,93,0.15)"/><circle cx="88" cy="74" r="2.5" fill="rgba(27,54,93,0.2)"/><ellipse cx="62" cy="82" rx="5" ry="2" fill="rgba(27,54,93,0.14)" transform="rotate(30 62 82)"/><circle cx="75" cy="66" r="3" fill="rgba(27,54,93,0.12)"/>
                                </g>
                                <g class="slab s1">
                                    <ellipse cx="208" cy="72" rx="46" ry="42" fill="rgba(27,54,93,0.05)" stroke="rgba(27,54,93,0.24)" stroke-width="1"/>
                                    <path d="M194 62 L197 57 L201 63 L205 58 L207 63 L203 66 L198 66Z" fill="rgba(27,54,93,0.2)"/><circle cx="218" cy="60" r="2.6" fill="rgba(27,54,93,0.16)"/><ellipse cx="204" cy="80" rx="5" ry="2.2" fill="rgba(27,54,93,0.14)" transform="rotate(-15 204 80)"/><circle cx="222" cy="76" r="2.8" fill="rgba(27,54,93,0.2)"/><circle cx="196" cy="78" r="2" fill="rgba(27,54,93,0.12)"/>
                                </g>
                                <g class="slab s2">
                                    <ellipse cx="72" cy="208" rx="46" ry="43" fill="rgba(27,54,93,0.05)" stroke="rgba(27,54,93,0.22)" stroke-width="1"/>
                                    <circle cx="60" cy="200" r="3" fill="rgba(27,54,93,0.16)"/><ellipse cx="82" cy="196" rx="4.5" ry="2" fill="rgba(27,54,93,0.2)" transform="rotate(25 82 196)"/><path d="M66 216 L69 211 L73 217 L77 212 L79 217 L75 220 L70 220Z" fill="rgba(27,54,93,0.14)"/><circle cx="86" cy="212" r="3" fill="rgba(27,54,93,0.18)"/><circle cx="56" cy="214" r="2.2" fill="rgba(27,54,93,0.12)"/>
                                </g>
                                <g class="slab s3">
                                    <ellipse cx="208" cy="208" rx="44" ry="42" fill="rgba(27,54,93,0.04)" stroke="rgba(27,54,93,0.2)" stroke-width="1"/>
                                    <ellipse cx="198" cy="200" rx="5" ry="2" fill="rgba(27,54,93,0.16)" transform="rotate(-10 198 200)"/><circle cx="218" cy="198" r="2.6" fill="rgba(27,54,93,0.18)"/><path d="M202 216 L205 211 L209 217 L213 212 L215 217 L211 220 L206 220Z" fill="rgba(27,54,93,0.12)"/><circle cx="220" cy="214" r="2.4" fill="rgba(27,54,93,0.16)"/>
                                </g>
                                <g class="slab s4">
                                    <ellipse cx="140" cy="140" rx="38" ry="36" fill="rgba(27,54,93,0.04)" stroke="rgba(27,54,93,0.18)" stroke-width="0.8"/>
                                    <circle cx="132" cy="134" r="2.8" fill="rgba(27,54,93,0.14)"/><path d="M146 130 L149 126 L152 131 L155 127 L156 132 L153 134 L149 134Z" fill="rgba(27,54,93,0.18)"/><ellipse cx="138" cy="148" rx="4" ry="1.8" fill="rgba(27,54,93,0.12)" transform="rotate(15 138 148)"/><circle cx="150" cy="146" r="2.2" fill="rgba(27,54,93,0.16)"/>
                                </g>
                                <line class="blade-line" x1="10" y1="140" x2="270" y2="140" stroke="rgba(27,54,93,0.3)" stroke-width="0.8" stroke-dasharray="6 4"/>
                                <path class="blade-line" d="M140 10 L140 270" stroke="rgba(27,54,93,0.3)" stroke-width="0.8" stroke-dasharray="6 4"/>
                            </svg>`;

const newSection = `<svg viewBox="0 0 240 240" fill="none" class="dia dia-section">
                                <!-- Projection lines drawing in -->
                                <path class="blade-line" d="M 80 160 L 80 60" stroke="rgba(27,54,93,0.15)" stroke-width="1" stroke-dasharray="4 4"/>
                                <path class="blade-line" d="M 120 180 L 120 80" stroke="rgba(27,54,93,0.15)" stroke-width="1" stroke-dasharray="4 4"/>
                                <path class="blade-line" d="M 160 160 L 160 60" stroke="rgba(27,54,93,0.15)" stroke-width="1" stroke-dasharray="4 4"/>

                                <!-- Main Tissue Block -->
                                <g class="slab s0">
                                    <!-- Left face -->
                                    <path d="M 80 160 L 80 190 L 120 210 L 120 180 Z" fill="rgba(27,54,93,0.08)" stroke="rgba(27,54,93,0.3)" stroke-width="1" stroke-linejoin="round"/>
                                    <!-- Right face -->
                                    <path d="M 120 180 L 120 210 L 160 190 L 160 160 Z" fill="rgba(27,54,93,0.12)" stroke="rgba(27,54,93,0.3)" stroke-width="1" stroke-linejoin="round"/>
                                    <!-- Top face -->
                                    <path d="M 80 160 L 120 180 L 160 160 L 120 140 Z" fill="rgba(27,54,93,0.04)" stroke="rgba(27,54,93,0.3)" stroke-width="1" stroke-linejoin="round"/>
                                    <!-- Top face details (cellular grid hint) -->
                                    <path d="M 95 162 L 115 172 M 105 157 L 125 167 M 115 152 L 135 162 M 125 147 L 145 157" stroke="rgba(27,54,93,0.15)" stroke-width="0.5"/>
                                    <path d="M 105 167 L 125 157 M 95 152 L 115 142 M 115 172 L 135 162 M 125 177 L 145 167" stroke="rgba(27,54,93,0.15)" stroke-width="0.5"/>
                                </g>

                                <!-- Slices -->
                                <g class="slab s1">
                                    <path d="M 80 130 L 120 150 L 160 130 L 120 110 Z" fill="rgba(27,54,93,0.03)" stroke="rgba(27,54,93,0.4)" stroke-width="1" stroke-linejoin="round"/>
                                    <circle cx="120" cy="130" r="1.5" fill="rgba(27,54,93,0.4)"/>
                                    <circle cx="105" cy="125" r="1" fill="rgba(27,54,93,0.3)"/>
                                    <circle cx="135" cy="135" r="1" fill="rgba(27,54,93,0.3)"/>
                                </g>

                                <g class="slab s2">
                                    <path d="M 80 100 L 120 120 L 160 100 L 120 80 Z" fill="rgba(27,54,93,0.03)" stroke="rgba(27,54,93,0.4)" stroke-width="1" stroke-linejoin="round"/>
                                    <circle cx="115" cy="100" r="1.5" fill="rgba(27,54,93,0.4)"/>
                                    <circle cx="130" cy="95" r="1" fill="rgba(27,54,93,0.3)"/>
                                    <circle cx="100" cy="105" r="1" fill="rgba(27,54,93,0.3)"/>
                                </g>

                                <g class="slab s3">
                                    <path d="M 80 70 L 120 90 L 160 70 L 120 50 Z" fill="rgba(27,54,93,0.03)" stroke="rgba(27,54,93,0.4)" stroke-width="1" stroke-linejoin="round"/>
                                    <circle cx="125" cy="70" r="1.5" fill="rgba(27,54,93,0.4)"/>
                                    <circle cx="110" cy="65" r="1" fill="rgba(27,54,93,0.3)"/>
                                    <circle cx="140" cy="75" r="1" fill="rgba(27,54,93,0.3)"/>
                                </g>

                                <!-- Microtome Blade Hint -->
                                <g class="slab s4">
                                    <path d="M 40 140 L 200 60" stroke="rgba(27,54,93,0.25)" stroke-width="1.5"/>
                                    <path d="M 40 140 L 50 150 L 210 70 L 200 60 Z" fill="rgba(27,54,93,0.04)" stroke="none"/>
                                </g>
                            </svg>`;

html = html.replace(oldSection, newSection);
fs.writeFileSync('index.html', html);
console.log('done');
