import sys

with open('index.html', 'r') as f:
    lines = f.readlines()

# Let's just rewrite the end of that section properly.
# Find the line with "AI Analysis"
idx = 0
for i, line in enumerate(lines):
    if "AI Analysis" in line:
        idx = i
        break

# Find the end of the pipe-step
while "</div>" not in lines[idx]:
    idx += 1
idx += 1 # move past the <p>
while "</div>" not in lines[idx]:
    idx += 1
idx += 1 # move past the pipe-text div
while "</div>" not in lines[idx]:
    idx += 1
# Now idx is at the </div> that closes pipe-step 05.

# We want to replace everything from here until <section id="research"
end_idx = idx
while '<section id="research"' not in lines[end_idx]:
    end_idx += 1

new_content = """                    </div> <!-- closes pipe-step 05 -->
                </div> <!-- closes pipeline-cards -->
            </div> <!-- closes pipeline-viewport -->

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

        </div> <!-- closes pipeline-sticky -->
    </div> <!-- closes pipeline-scroll -->
</section> <!-- closes pipeline-section -->

"""

lines = lines[:idx] + [new_content] + lines[end_idx:]

with open('index.html', 'w') as f:
    f.writelines(lines)
print("done")
