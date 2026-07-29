# Astra paper

The paper source is in `main.tex`, with citations in `references.bib` and publication-ready images in `figures/`. The compiled manuscript is `main.pdf`.

The `gate05/`, `student_gate05/`, and `influence/` directories contain experiment outputs used to generate the paper figures. They are intentionally excluded from Git because they contain many generated data and image files.

To rebuild the manuscript:

```bash
pdflatex main.tex
bibtex main
pdflatex main.tex
pdflatex main.tex
```
