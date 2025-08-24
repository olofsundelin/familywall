import React, { useState, useEffect } from 'react';
import './PictureSlideshow.css';

const shuffleArray = (array) => {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

function PictureSlideshow({ images, interval = 10000 }) {
  const [shuffledImages, setShuffledImages] = useState([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (images?.length > 0) {
      setShuffledImages(shuffleArray(images));
      setIndex(0);
    }
  }, [images]);

  useEffect(() => {
    if (shuffledImages.length === 0) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % shuffledImages.length);
    }, interval);
    return () => clearInterval(timer);
  }, [shuffledImages, interval]);

  const current = shuffledImages[index];
  if (!current) return null;

  const isLandscape = current.width > current.height;
  const next = shuffledImages[(index + 1) % shuffledImages.length];
  const showTwo = isLandscape && next && next.width > next.height;

  return (
    <div className="slideshow-container">
      {showTwo ? (
        <div className="image-pair">
          <img src={current.src} alt="slide1" className="landscape" />
          <img src={next.src} alt="slide2" className="landscape" />
        </div>
      ) : (
        <img src={current.src} alt="slide" className="single" />
      )}
    </div>
  );
}

export default PictureSlideshow;