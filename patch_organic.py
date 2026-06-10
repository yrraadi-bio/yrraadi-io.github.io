import sys

with open('index.html', 'r') as f:
    html = f.read()

old_tissue = """                            <svg viewBox="0 0 240 240" fill="none" class="dia dia-tissue">
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

new_tissue = """                            <svg viewBox="0 0 240 240" fill="none" class="dia dia-tissue">
                                <g class="cell-dot" style="--i:0">
                                    <!-- 3D Organic Tissue Block -->
                                    <!-- Bottom edge -->
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" stroke="rgba(27,54,93,0.3)" stroke-width="1.5" transform="translate(0, 20)"/>
                                    <!-- Solid Wall (Extrusion) -->
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" transform="translate(0, 18)"/>
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" transform="translate(0, 16)"/>
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" transform="translate(0, 14)"/>
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" transform="translate(0, 12)"/>
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" transform="translate(0, 10)"/>
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" transform="translate(0, 8)"/>
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" transform="translate(0, 6)"/>
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" transform="translate(0, 4)"/>
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" transform="translate(0, 2)"/>
                                    <!-- Top Face -->
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.04)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" transform="translate(0, 0)"/>
                                </g>
                            </svg>"""

old_section = """                            <svg viewBox="0 0 240 240" fill="none" class="dia dia-section">
                                <!-- Projection lines drawing in -->
                                <path class="blade-line" d="M 80 160 L 80 60" stroke="rgba(27,54,93,0.15)" stroke-width="1" stroke-dasharray="4 4"/>
                                <path class="blade-line" d="M 120 180 L 120 80" stroke="rgba(27,54,93,0.15)" stroke-width="1" stroke-dasharray="4 4"/>
                                <path class="blade-line" d="M 160 160 L 160 60" stroke="rgba(27,54,93,0.15)" stroke-width="1" stroke-dasharray="4 4"/>

                                <!-- Main Tissue Block -->
                                <g class="slab s0">
                                    <!-- Left face -->
                                    <path d="M 80 160 L 80 190 L 120 210 L 120 180 Z" fill="rgba(27,54,93,0.08)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" stroke-linejoin="round"/>
                                    <!-- Right face -->
                                    <path d="M 120 180 L 120 210 L 160 190 L 160 160 Z" fill="rgba(27,54,93,0.12)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" stroke-linejoin="round"/>
                                    <!-- Top face -->
                                    <path d="M 80 160 L 120 180 L 160 160 L 120 140 Z" fill="rgba(27,54,93,0.04)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" stroke-linejoin="round"/>
                                </g>

                                <!-- Slices -->
                                <g class="slab s1">
                                    <path d="M 80 130 L 120 150 L 160 130 L 120 110 Z" fill="rgba(27,54,93,0.03)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" stroke-linejoin="round"/>
                                </g>

                                <g class="slab s2">
                                    <path d="M 80 100 L 120 120 L 160 100 L 120 80 Z" fill="rgba(27,54,93,0.03)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" stroke-linejoin="round"/>
                                </g>

                                <g class="slab s3">
                                    <path d="M 80 70 L 120 90 L 160 70 L 120 50 Z" fill="rgba(27,54,93,0.03)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" stroke-linejoin="round"/>
                                </g>
                            </svg>"""

new_section = """                            <svg viewBox="0 0 240 240" fill="none" class="dia dia-section">
                                <!-- Projection line drawing in -->
                                <path class="blade-line" d="M 125 150 L 125 50" stroke="rgba(27,54,93,0.15)" stroke-width="1" stroke-dasharray="4 4"/>
                                
                                <!-- Main Tissue Block (Bottom remainder) -->
                                <g class="slab s0">
                                    <!-- Bottom edge -->
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" stroke="rgba(27,54,93,0.3)" stroke-width="1.5" transform="translate(0, 20)"/>
                                    <!-- Wall -->
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" transform="translate(0, 18)"/>
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" transform="translate(0, 16)"/>
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" transform="translate(0, 14)"/>
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" transform="translate(0, 12)"/>
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.08)" transform="translate(0, 10)"/>
                                    <!-- Top Face of the remainder -->
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.04)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" transform="translate(0, 10)"/>
                                </g>

                                <!-- Slices -->
                                <g class="slab s1">
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.03)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" transform="translate(0, -10)"/>
                                </g>

                                <g class="slab s2">
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.03)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" transform="translate(0, -30)"/>
                                </g>

                                <g class="slab s3">
                                    <path d="M 80 110 C 90 80, 150 70, 170 100 C 190 130, 170 160, 130 160 C 90 160, 60 140, 80 110 Z" fill="rgba(27,54,93,0.03)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" transform="translate(0, -50)"/>
                                </g>
                            </svg>"""

if old_tissue in html and old_section in html:
    html = html.replace(old_tissue, new_tissue)
    html = html.replace(old_section, new_section)
    with open('index.html', 'w') as f:
        f.write(html)
    print("Replaced both successfully")
else:
    print("Could not find one or both sections")
