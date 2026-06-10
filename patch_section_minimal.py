import sys

with open('index.html', 'r') as f:
    html = f.read()

old_section = """                            <svg viewBox="0 0 240 240" fill="none" class="dia dia-section">
                                <!-- Projection lines drawing in -->
                                <path class="blade-line" d="M 80 160 L 80 60" stroke="rgba(27,54,93,0.15)" stroke-width="1" />
                                <path class="blade-line" d="M 120 180 L 120 80" stroke="rgba(27,54,93,0.15)" stroke-width="1" />
                                <path class="blade-line" d="M 160 160 L 160 60" stroke="rgba(27,54,93,0.15)" stroke-width="1" />

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
                            </svg>"""

new_section = """                            <svg viewBox="0 0 240 240" fill="none" class="dia dia-section">
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

if old_section in html:
    html = html.replace(old_section, new_section)
    with open('index.html', 'w') as f:
        f.write(html)
    print("Replaced successfully")
else:
    print("Old section not found")
