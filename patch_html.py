import sys

with open('index.html', 'r') as f:
    html = f.read()

old_html = """    <section id="platform" class="pipeline-section">
        <div class="pipeline-scroll" id="pipelineScroll">
            <div class="pipeline-viewport">"""

new_html = """    <section id="platform" class="pipeline-section">
        <div class="pipeline-scroll" id="pipelineScroll">
            <div class="pipeline-sticky">
                <div class="pipeline-viewport">"""

html = html.replace(old_html, new_html)

old_html_2 = """                        </div>
            </div>
        </div>
    </section>

    <section class="team-section">
        <div class="section-header" data-reveal="fade-up" data-delay="0">
            <span class="section-label">Team From</span>
        </div>
        <div class="logo-grid" data-reveal="fade-up" data-delay="100">
            <img src="company_logos/nvidia-logo-vert.png" alt="NVIDIA" class="company-logo">
            <img src="company_logos/UC-Berkeley-Symbol.png" alt="UC Berkeley" class="company-logo">
            <img src="company_logos/UniversityofPennsylvania_FullLogo_RGB-4_0.png" alt="UPenn" class="company-logo">
            <img src="company_logos/UIUC-Logo.jpg" alt="UIUC" class="company-logo">
        </div>
    </section>"""

new_html_2 = """                        </div>
            </div>
        </div>

        <section class="team-section">
            <div class="section-header" data-reveal="fade-up" data-delay="0">
                <span class="section-label">Team From</span>
            </div>
            <div class="logo-grid" data-reveal="fade-up" data-delay="100">
                <img src="company_logos/nvidia-logo-vert.png" alt="NVIDIA" class="company-logo">
                <img src="company_logos/UC-Berkeley-Symbol.png" alt="UC Berkeley" class="company-logo">
                <img src="company_logos/UniversityofPennsylvania_FullLogo_RGB-4_0.png" alt="UPenn" class="company-logo">
                <img src="company_logos/UIUC-Logo.jpg" alt="UIUC" class="company-logo">
            </div>
        </section>
        </div>
    </div>
    </section>"""

html = html.replace(old_html_2, new_html_2)

with open('index.html', 'w') as f:
    f.write(html)
print("done")
