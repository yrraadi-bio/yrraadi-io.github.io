import sys

with open('index.html', 'r') as f:
    html = f.read()

old_section = """                            <svg viewBox="0 0 240 240" fill="none" class="dia dia-tissue">
                                <!-- Tech-bio outer rings -->
                                <circle class="ring" style="--i:0" cx="120" cy="120" r="95" stroke="rgba(27,54,93,0.15)" stroke-width="1" stroke-dasharray="4 4" />
                                <circle class="ring" style="--i:1" cx="120" cy="120" r="82" stroke="rgba(27,54,93,0.2)" stroke-width="1.5" fill="rgba(27,54,93,0.02)"/>
                                
                                <!-- Abstract tissue matrix (interlocking geometric shapes) -->
                                <g transform="translate(120, 120)">
                                    <!-- Cell 1 -->
                                    <path class="cell-dot" style="--i:2" d="M-22,-45 L22,-52 L42,-12 L12,22 L-32,2 Z" fill="rgba(27,54,93,0.06)" stroke="rgba(27,54,93,0.25)" stroke-width="1.2" stroke-linejoin="round"/>
                                    <circle class="cell-dot core-ring" style="--i:2" cx="5" cy="-15" r="4.5" fill="rgba(27,54,93,0.4)"/>
                                    
                                    <!-- Cell 2 -->
                                    <path class="cell-dot" style="--i:3" d="M22,-52 L62,-32 L52,12 L42,-12 Z" fill="rgba(27,54,93,0.09)" stroke="rgba(27,54,93,0.25)" stroke-width="1.2" stroke-linejoin="round"/>
                                    <circle class="cell-dot" style="--i:3" cx="44" cy="-22" r="3.5" fill="rgba(27,54,93,0.35)"/>
                                    
                                    <!-- Cell 3 -->
                                    <path class="cell-dot" style="--i:4" d="M42,-12 L52,12 L22,52 L-12,42 L12,22 Z" fill="rgba(27,54,93,0.05)" stroke="rgba(27,54,93,0.25)" stroke-width="1.2" stroke-linejoin="round"/>
                                    <circle class="cell-dot" style="--i:4" cx="22" cy="22" r="5" fill="rgba(27,54,93,0.45)"/>
                                    
                                    <!-- Cell 4 -->
                                    <path class="cell-dot" style="--i:5" d="M12,22 L-12,42 L-42,32 L-52,-12 L-32,2 Z" fill="rgba(27,54,93,0.07)" stroke="rgba(27,54,93,0.25)" stroke-width="1.2" stroke-linejoin="round"/>
                                    <circle class="cell-dot" style="--i:5" cx="-22" cy="17" r="4" fill="rgba(27,54,93,0.35)"/>
                                    
                                    <!-- Cell 5 -->
                                    <path class="cell-dot" style="--i:6" d="M-32,2 L-52,-12 L-42,-42 L-22,-45 Z" fill="rgba(27,54,93,0.04)" stroke="rgba(27,54,93,0.25)" stroke-width="1.2" stroke-linejoin="round"/>
                                    <circle class="cell-dot" style="--i:6" cx="-32" cy="-22" r="3.5" fill="rgba(27,54,93,0.4)"/>
                                    
                                    <!-- Stroma / Fibers -->
                                    <path class="ring" style="--i:1" d="M-65,-65 Q-25,-85 35,-65 T85,-25" stroke="rgba(27,54,93,0.15)" stroke-width="1.5" fill="none"/>
                                    <path class="ring" style="--i:2" d="M-75,5 Q-45,35 -65,75" stroke="rgba(27,54,93,0.15)" stroke-width="1.5" fill="none"/>
                                    <path class="ring" style="--i:3" d="M35,65 Q65,85 75,45" stroke="rgba(27,54,93,0.15)" stroke-width="1.5" fill="none"/>
                                </g>
                            </svg>"""

new_section = """                            <svg viewBox="0 0 240 240" fill="none" class="dia dia-tissue">
                                <!-- Outer target rings -->
                                <circle class="ring" style="--i:0" cx="120" cy="120" r="95" stroke="rgba(27,54,93,0.1)" stroke-width="1" stroke-dasharray="2 4" />
                                <circle class="ring" style="--i:1" cx="120" cy="120" r="75" stroke="rgba(27,54,93,0.05)" stroke-width="1" />

                                <!-- Vertical targeting line -->
                                <path class="cell-dot" style="--i:2" d="M 120 25 L 120 60" stroke="rgba(27,54,93,0.25)" stroke-width="1.5" stroke-dasharray="4 4"/>
                                <path class="cell-dot" style="--i:2" d="M 115 55 L 120 60 L 125 55" stroke="rgba(27,54,93,0.25)" stroke-width="1.5" stroke-linejoin="round" fill="none"/>

                                <!-- Isometric Tissue Block (Whole) -->
                                <g class="cell-dot" style="--i:3">
                                    <!-- Left face -->
                                    <path d="M 70 100 L 120 125 L 120 185 L 70 160 Z" fill="rgba(27,54,93,0.08)" stroke="rgba(27,54,93,0.35)" stroke-width="1.5" stroke-linejoin="round"/>
                                    <!-- Right face -->
                                    <path d="M 120 125 L 170 100 L 170 160 L 120 185 Z" fill="rgba(27,54,93,0.12)" stroke="rgba(27,54,93,0.35)" stroke-width="1.5" stroke-linejoin="round"/>
                                    <!-- Top face -->
                                    <path d="M 120 75 L 170 100 L 120 125 L 70 100 Z" fill="rgba(27,54,93,0.04)" stroke="rgba(27,54,93,0.35)" stroke-width="1.5" stroke-linejoin="round"/>
                                    
                                    <!-- Clean geometric grid on top face to represent "mapping/analysis" -->
                                    <path d="M 132.5 81.25 L 82.5 106.25" stroke="rgba(27,54,93,0.15)" stroke-width="1"/>
                                    <path d="M 145 87.5 L 95 112.5" stroke="rgba(27,54,93,0.15)" stroke-width="1"/>
                                    <path d="M 157.5 93.75 L 107.5 118.75" stroke="rgba(27,54,93,0.15)" stroke-width="1"/>
                                    <path d="M 107.5 81.25 L 157.5 106.25" stroke="rgba(27,54,93,0.15)" stroke-width="1"/>
                                    <path d="M 95 87.5 L 145 112.5" stroke="rgba(27,54,93,0.15)" stroke-width="1"/>
                                    <path d="M 82.5 93.75 L 132.5 118.75" stroke="rgba(27,54,93,0.15)" stroke-width="1"/>
                                </g>

                                <!-- Targeting brackets -->
                                <g class="cell-dot" style="--i:4" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" fill="none" stroke-linejoin="round">
                                    <path d="M 110 65 L 120 60 L 130 65" />
                                    <path d="M 110 195 L 120 200 L 130 195" />
                                    <path d="M 60 125 L 55 130 L 60 135" />
                                    <path d="M 180 125 L 185 130 L 180 135" />
                                </g>
                            </svg>"""

if old_section in html:
    html = html.replace(old_section, new_section)
    with open('index.html', 'w') as f:
        f.write(html)
    print("Replaced successfully")
else:
    print("Old section not found")
