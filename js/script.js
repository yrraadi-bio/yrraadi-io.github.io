// script.js

// Select all the spiral-line elements
const spiralLines = document.querySelectorAll('.spiral-line');

// Function to animate the wave effect on mouse enter
spiralLines.forEach((line) => {
    line.addEventListener('mouseenter', () => {
        // Determine the direction of movement randomly: left (-) or right (+)
        const direction = Math.random() < 0.5 ? -1 : 1;
        const xOffset = direction * 5; // Move 10 pixels to the left or right

        // Start bobbing the element smoothly
        line.style.transition = 'transform 0.2s ease-in-out';
        line.style.transform = `translateX(${xOffset}px)`;

        // After the movement ends, bring the element back to its original position
        setTimeout(() => {
            line.style.transform = 'translateX(0px)';
        }, 400); // This delay should match the transition duration
    });
});
