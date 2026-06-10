import sys

with open('index.html', 'r') as f:
    html = f.read()

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
                                <!-- Projection lines drawing in -->
                                <path class="blade-line" d="M 70 160 L 70 60" stroke="rgba(27,54,93,0.15)" stroke-width="1" stroke-dasharray="4 4"/>
                                <path class="blade-line" d="M 170 160 L 170 60" stroke="rgba(27,54,93,0.15)" stroke-width="1" stroke-dasharray="4 4"/>

                                <!-- Main Tissue Cylinder Base -->
                                <g class="slab s0">
                                    <!-- Cylinder Body (Lower half) -->
                                    <path d="M 70 160 L 70 190 A 50 25 0 0 0 170 190 L 170 160 A 50 25 0 0 1 70 160 Z" fill="rgba(27,54,93,0.08)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5" stroke-linejoin="round"/>
                                    <!-- Top Face (Ellipse) -->
                                    <ellipse cx="120" cy="160" rx="50" ry="25" fill="rgba(27,54,93,0.04)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5"/>
                                </g>

                                <!-- Slices (Ellipses) -->
                                <g class="slab s1">
                                    <ellipse cx="120" cy="130" rx="50" ry="25" fill="rgba(27,54,93,0.03)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5"/>
                                </g>

                                <g class="slab s2">
                                    <ellipse cx="120" cy="100" rx="50" ry="25" fill="rgba(27,54,93,0.03)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5"/>
                                </g>

                                <g class="slab s3">
                                    <ellipse cx="120" cy="70" rx="50" ry="25" fill="rgba(27,54,93,0.03)" stroke="rgba(27,54,93,0.4)" stroke-width="1.5"/>
                                </g>
                            </svg>"""

if old_section in html:
    html = html.replace(old_section, new_section)
    with open('index.html', 'w') as f:
        f.write(html)
    print("Replaced section successfully")
else:
    print("Old section not found")
