import sys

with open('index.html', 'r') as f:
    html = f.read()

old_section = """                            <svg viewBox="0 0 240 240" fill="none" class="dia dia-tissue">
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

new_section = """                            <svg viewBox="0 0 240 240" fill="none" class="dia dia-tissue">
                                <!-- Cylinder Tissue Core (Whole, Minimal) -->
                                <g class="cell-dot" style="--i:0">
                                    <!-- Cylinder Body -->
                                    <path d="M 70 100 L 70 160 A 50 25 0 0 0 170 160 L 170 100 A 50 25 0 0 1 70 100 Z" fill="rgba(27,54,93,0.08)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" stroke-linejoin="round"/>
                                    
                                    <!-- Top Face (Ellipse) -->
                                    <ellipse cx="120" cy="100" rx="50" ry="25" fill="rgba(27,54,93,0.04)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5"/>
                                    
                                    <!-- Minimal surface detail (curved grid lines) -->
                                    <path d="M 85 93 A 40 20 0 0 0 155 93" stroke="rgba(27,54,93,0.15)" stroke-width="1" fill="none"/>
                                    <path d="M 85 107 A 40 20 0 0 1 155 107" stroke="rgba(27,54,93,0.15)" stroke-width="1" fill="none"/>
                                    <path d="M 105 80 A 20 40 0 0 0 105 120" stroke="rgba(27,54,93,0.15)" stroke-width="1" fill="none"/>
                                    <path d="M 135 80 A 20 40 0 0 1 135 120" stroke="rgba(27,54,93,0.15)" stroke-width="1" fill="none"/>
                                </g>
                            </svg>"""

if old_section in html:
    html = html.replace(old_section, new_section)
    with open('index.html', 'w') as f:
        f.write(html)
    print("Replaced tissue successfully")
else:
    print("Old tissue section not found")
