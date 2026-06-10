import sys

with open('index.html', 'r') as f:
    html = f.read()

old_section = """                            <svg viewBox="0 0 240 240" fill="none" class="dia dia-tissue">
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

new_section = """                            <svg viewBox="0 0 240 240" fill="none" class="dia dia-tissue">
                                <!-- Isometric Tissue Block (Whole, Minimal) -->
                                <g class="cell-dot" style="--i:0">
                                    <!-- Left face -->
                                    <path d="M 70 100 L 120 125 L 120 185 L 70 160 Z" fill="rgba(27,54,93,0.08)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" stroke-linejoin="round"/>
                                    <!-- Right face -->
                                    <path d="M 120 125 L 170 100 L 170 160 L 120 185 Z" fill="rgba(27,54,93,0.12)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" stroke-linejoin="round"/>
                                    <!-- Top face -->
                                    <path d="M 120 75 L 170 100 L 120 125 L 70 100 Z" fill="rgba(27,54,93,0.04)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" stroke-linejoin="round"/>
                                    
                                    <!-- Minimal surface detail -->
                                    <path d="M 95 87.5 L 145 112.5" stroke="rgba(27,54,93,0.15)" stroke-width="1"/>
                                    <path d="M 145 87.5 L 95 112.5" stroke="rgba(27,54,93,0.15)" stroke-width="1"/>
                                </g>
                            </svg>"""

if old_section in html:
    html = html.replace(old_section, new_section)
    with open('index.html', 'w') as f:
        f.write(html)
    print("Replaced successfully")
else:
    print("Old section not found")
