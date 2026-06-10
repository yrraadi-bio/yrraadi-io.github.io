import sys

with open('index.html', 'r') as f:
    html = f.read()

old_html = """            <div class="pipeline-sticky">
                <div class="pipeline-viewport">
                <div class="pipeline-viewport-label">
                    <span class="section-label">The Platform</span>
                </div>
                <div class="pipeline-cards">"""

new_html = """            <div class="pipeline-sticky">
                <div class="pipeline-viewport-label">
                    <span class="section-label">The Platform</span>
                </div>
                <div class="pipeline-viewport">
                <div class="pipeline-cards">"""

html = html.replace(old_html, new_html)

with open('index.html', 'w') as f:
    f.write(html)
print("done")
