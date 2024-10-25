// Select all the spiral-line elements
const spiralLines = document.querySelectorAll('.spiral-line');

// Function to animate the wave effect on mouse enter (unchanged)
spiralLines.forEach((line) => {
    line.addEventListener('mouseenter', () => {
        // Determine the direction of movement randomly: up (-) or down (+)
        const direction = Math.random() < 0.5 ? -1 : 1;
        const yOffset = direction * 5; // Move 5 pixels up or down

        // Start bobbing the element smoothly
        line.style.transition = 'transform 0.2s ease-in-out';
        line.style.transform = `translateY(${yOffset}px)`;

        // After the movement ends, bring the element back to its original position
        setTimeout(() => {
            line.style.transform = 'translateY(0px)'; // Reset position without any rotation
        }, 400); // This delay should match the transition duration
    });
});

// Select the image element in the header
const logoImg = document.querySelector('header img');

// Function to animate the "breaking apart" effect when the logo is clicked
logoImg.addEventListener('click', () => {
    // Get the total number of spiral lines
    const totalLines = spiralLines.length;
    // Calculate the middle index to split the lines into two halves
    const middleIndex = Math.floor(totalLines / 2);

    // Animate the top half upwards
    for (let i = 0; i < middleIndex; i++) {
        spiralLines[i].style.transition = 'transform 0.5s ease-in-out';
        spiralLines[i].style.transform = 'translateY(-20px)'; // Shift upwards by 20px
    }

    // Animate the bottom half downwards
    for (let i = middleIndex; i < totalLines; i++) {
        spiralLines[i].style.transition = 'transform 0.5s ease-in-out';
        spiralLines[i].style.transform = 'translateY(20px)'; // Shift downwards by 20px
    }

    // Optional: bring the elements back to the original position after a delay
    setTimeout(() => {
        for (let i = 0; i < totalLines; i++) {
            spiralLines[i].style.transform = 'translateY(0px)'; // Reset position smoothly
        }
    }, 1000); // Adjust the delay as needed
});
