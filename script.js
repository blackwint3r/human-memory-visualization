(() => {
  const canvas = document.getElementById("memoryCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const ageSlider = document.getElementById("ageSlider");
  const ageValue = document.getElementById("ageValue");
  const forgettingSlider = document.getElementById("forgettingSlider");
  const forgettingLabel = document.getElementById("forgettingLabel");
  const plasticitySlider = document.getElementById("plasticitySlider");
  const plasticityLabel = document.getElementById("plasticityLabel");
  const playBtn = document.getElementById("playBtn");
  const resetBtn = document.getElementById("resetBtn");

  const ageReadout = document.getElementById("ageReadout");
  const incrementReadout = document.getElementById("incrementReadout");
  const memoryReadout = document.getElementById("memoryReadout");
  const kernelReadout = document.getElementById("kernelReadout");
  const contributionBar = document.getElementById("contributionBar");
  const contributionLegend = document.getElementById("contributionLegend");

  const lifeSpan = 80;
  const steps = 360;
  const times = new Float32Array(steps);
  const acquisition = new Float32Array(steps);
  const dt = lifeSpan / (steps - 1);
  const memory = new Float32Array(steps);
  const density = new Float32Array(steps);
  const contributionBuckets = [
    { label: "0-10 岁" },
    { label: "10-20 岁" },
    { label: "20-30 岁" },
    { label: "30-45 岁" },
    { label: "45-60 岁" },
    { label: "60+ 岁" },
  ];
  
  // Global variables for bucket layers
  const bucketBoundaries = [0, 10, 20, 30, 45, 60, lifeSpan];
  const bucketLayers = contributionBuckets.map(() => new Float32Array(steps));
  const timeBucketIndices = new Int32Array(steps);

  const bucketColors = [
    "#c4d0ff", // 0-10 (Very Light Blue - High brightness)
    "#9eb2ff", // 10-20
    "#7c8dff", // 20-30 (Base Accent Blue)
    "#5a6ee0", // 30-45
    "#3b50bf", // 45-60
    "#1e329b", // 60+ (Dark Blue)
  ];
  const bucketFractions = new Float32Array(contributionBuckets.length);

  for (let i = 0; i < steps; i += 1) {
    times[i] = (i / (steps - 1)) * lifeSpan;
    // Pre-calculate which bucket this time index belongs to
    const t = times[i];
    let bucketIndex = 0;
    for(let k=0; k<bucketBoundaries.length-1; k++) {
         if(t >= bucketBoundaries[k] && t < bucketBoundaries[k+1]) {
             bucketIndex = k;
             break;
         }
         if (k === bucketBoundaries.length - 2 && t >= bucketBoundaries[k]) {
             bucketIndex = k;
         }
    }
    timeBucketIndices[i] = bucketIndex;
  }

  let logicalWidth = canvas.clientWidth || canvas.width;
  let logicalHeight = canvas.clientHeight || canvas.height;
  let lastTimestamp = 0;

  const state = {
    age: parseFloat(ageSlider.value),
    playing: true,
    forgetting: parseFloat(forgettingSlider.value),
    plasticityPeak: parseFloat(plasticitySlider.value),
  };

  const retentionLUT = [
    { limit: 0.82, label: "快速遗忘" },
    { limit: 1.12, label: "中性" },
    { limit: Infinity, label: "长期保持" },
  ];

  const computeKernelParams = (strength) => {
    const mix = (strength - 0.6) / (1.4 - 0.6);
    const fast = 1.2 + mix * 2.8;
    const slow = 6 + mix * 12;
    return { fast, slow };
  };

  let kernelParams = computeKernelParams(state.forgetting);
  let maxAcquisition = 0;
  let maxMemory = 0;

  const kernel = (delta) => {
    if (delta < 0) return 0;
    return (
      Math.exp(-delta / kernelParams.fast) +
      0.35 * Math.exp(-delta / kernelParams.slow)
    );
  };

  const plasticityCurve = (t) => {
    const normalized = Math.max(t, 0) / lifeSpan;
    const childhoodRise = 1 / (1 + Math.exp(-(t - 8) / 3));
    const agingGate = 1 / (1 + Math.exp((t - state.plasticityPeak) / 6));
    const modulation = 0.6 + Math.pow(normalized, 0.55);
    return childhoodRise * agingGate * modulation;
  };

  const recomputeAcquisition = () => {
    maxAcquisition = 0;
    for (let i = 0; i < steps; i += 1) {
      const value = plasticityCurve(times[i]);
      acquisition[i] = value;
      if (value > maxAcquisition) maxAcquisition = value;
    }
  };

  const recomputeMemory = () => {
    maxMemory = 0;
    // Reset layers
    for (let b = 0; b < bucketLayers.length; b++) {
        bucketLayers[b].fill(0);
    }

    for (let j = 0; j < steps; j += 1) {
      let sum = 0;
      for (let i = 0; i <= j; i += 1) {
        const weight = kernel(times[j] - times[i]);
        const contribution = acquisition[i] * weight * dt;
        sum += contribution;
        
        // Add to corresponding bucket layer
        const bIndex = timeBucketIndices[i];
        bucketLayers[bIndex][j] += contribution;
      }
      memory[j] = sum;
      if (sum > maxMemory) maxMemory = sum;
    }
  };

  const resizeCanvas = () => {
    logicalWidth = canvas.clientWidth || canvas.width;
    logicalHeight = canvas.clientHeight || canvas.height;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = logicalWidth * ratio;
    canvas.height = logicalHeight * ratio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
  };

  const updatePlayLabel = () => {
    playBtn.textContent = state.playing ? "暂停动画" : "播放动画";
  };

  const updateRetentionLabels = () => {
    const desc = retentionLUT.find((item) => state.forgetting <= item.limit);
    forgettingLabel.textContent = desc ? desc.label : "中性";
    kernelReadout.textContent = `短 ${kernelParams.fast.toFixed(
      1
    )} 年 · 长 ${kernelParams.slow.toFixed(1)} 年`;
  };

  const updatePlasticityLabel = () => {
    plasticityLabel.textContent = `${state.plasticityPeak.toFixed(1)} 岁`;
  };

  const setAge = (value) => {
    state.age = Math.min(lifeSpan, Math.max(0, value));
    ageSlider.value = state.age.toFixed(1);
    ageValue.textContent = `${state.age.toFixed(1)} 岁`;
  };

  const setForgetting = (value) => {
    state.forgetting = value;
    forgettingSlider.value = value.toFixed(2);
    kernelParams = computeKernelParams(value);
    recomputeMemory();
    updateRetentionLabels();
  };

  const updateContributionUI = () => {
    if (!contributionBar || !contributionLegend) return;
    contributionBar.innerHTML = "";
    contributionLegend.innerHTML = "";
    for (let i = 0; i < contributionBuckets.length; i += 1) {
      const percent = bucketFractions[i] * 100;
      const segment = document.createElement("div");
      segment.className = "bar-segment";
      const flexValue = percent > 0 ? bucketFractions[i] : 0.00001;
      segment.style.flexGrow = flexValue;
      segment.style.flexShrink = 1;
      segment.style.flexBasis = "0%";
      segment.style.background = bucketColors[i % bucketColors.length];
      const label = `${contributionBuckets[i].label} ${percent.toFixed(1)}%`;
      segment.textContent = percent >= 8 ? label : "";
      if (percent < 8) {
        segment.classList.add("segment-tight");
        segment.dataset.label = label;
      } else {
        segment.classList.remove("segment-tight");
        delete segment.dataset.label;
      }
      segment.title = `${contributionBuckets[i].label} · ${percent.toFixed(1)}%`;
      contributionBar.appendChild(segment);
    }
  };

  const setPlasticityPeak = (value) => {
    state.plasticityPeak = value;
    plasticitySlider.value = value.toFixed(1);
    updatePlasticityLabel();
    recomputeAcquisition();
    recomputeMemory();
  };

  const drawScene = () => {
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);

    const padding = 40;
    const chartWidth = Math.max(200, logicalWidth - padding * 2);
    const topHeight = Math.max(100, logicalHeight * 0.3);
    const topTop = padding;
    const topBase = topTop + topHeight;
    const kernelScale = topHeight * 0.75;

    const bottomBase = logicalHeight - padding;
    const densityHeight = Math.max(60, logicalHeight * 0.15);
    const densityTop = topBase + 25;
    const densityBase = densityTop + densityHeight;
    const availableForResult = bottomBase - densityBase - 30;
    const resultHeight = Math.max(100, availableForResult);
    const resultTop = densityBase + 30;
    const resultBase = resultTop + resultHeight;

    const timeToX = (t) => padding + (t / lifeSpan) * chartWidth;
    const kernelPeak = kernel(0) || 1;
    const acquisitionToY = (val) =>
      topBase - (val / (maxAcquisition || 1)) * topHeight * 0.4;
    const kernelToY = (val) =>
      topBase - (val / kernelPeak) * kernelScale;
    const memoryToY = (val) =>
      resultBase - (val / (maxMemory || 1)) * resultHeight;
    const barWidth = chartWidth / (steps - 1);
    for (let i = 0; i < steps; i += 1) {
      if (times[i] <= state.age) {
        const value = acquisition[i] * kernel(state.age - times[i]);
        density[i] = value;
      } else {
        density[i] = 0;
      }
    }
    const densityReference = maxAcquisition || 1;
    const densityToY = (val) =>
      densityBase - (val / densityReference) * densityHeight;

    const currentIndex = Math.min(
      steps - 1,
      Math.round((state.age / lifeSpan) * (steps - 1))
    );
    const currentMemory = memory[currentIndex] || 1;

    // Recalculate bucket fractions for current age for the UI bar
    bucketFractions.fill(0);
    let calculatedTotal = 0;
    if (currentMemory > 0) {
      for (let b = 0; b < bucketLayers.length; b++) {
          // Just grab the value from our pre-calculated layers at current index
          const val = bucketLayers[b][currentIndex];
          bucketFractions[b] = val;
          calculatedTotal += val;
      }
      // Normalize
      if (calculatedTotal > 0) {
        for (let b = 0; b < bucketFractions.length; b++) {
          bucketFractions[b] /= calculatedTotal;
        }
      }
    }
    updateContributionUI();

    ctx.save();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.1)"; // Use dark grid lines for light mode
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i += 1) {
      const y = topTop + (i / 5) * topHeight;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(padding + chartWidth, y);
      ctx.stroke();
    }
    ctx.restore();

    // Draw Acquisition
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(padding, topBase);
    for (let i = 0; i < steps; i += 1) {
      const x = timeToX(times[i]);
      const y = acquisitionToY(acquisition[i]);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = "rgba(255, 152, 194, 0.9)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // Draw Kernel
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(padding, topBase);
    for (let i = 0; i < steps; i += 1) {
      const x = timeToX(times[i]);
      const value = kernel(state.age - times[i]);
      const y = kernelToY(value);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = "rgba(255, 217, 102, 0.95)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // Draw Stacked Memory Areas
    // We draw from the bottom up. Layer 0 is on bottom.
    // To make it stack, Layer k's bottom is Layer k-1's top.
    // Layer 0's bottom is resultBase.
    
    for (let b = 0; b < bucketLayers.length; b++) {
        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = bucketColors[b];
        
        // Trace top line (forward)
        // top Y = memoryToY( sum(0..b) )
        for (let i = 0; i <= currentIndex; i++) {
            let sum = 0;
            for (let k = 0; k <= b; k++) sum += bucketLayers[k][i];
            const x = timeToX(times[i]);
            const y = memoryToY(sum);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        
        // Trace bottom line (backward)
        // bottom Y = memoryToY( sum(0..b-1) )
        for (let i = currentIndex; i >= 0; i--) {
            let sum = 0;
            for (let k = 0; k < b; k++) sum += bucketLayers[k][i];
            const x = timeToX(times[i]);
            const y = memoryToY(sum);
            ctx.lineTo(x, y);
        }
        
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // Draw Memory Curve Outline (Total) with Gradient Stroke
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(padding, resultBase);
    let started = false;
    for (let i = 0; i <= currentIndex; i += 1) {
      const x = timeToX(times[i]);
      const y = memoryToY(memory[i]);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    const envelopeGradient = ctx.createLinearGradient(padding, 0, padding + chartWidth, 0);
    for (let b = 0; b < bucketColors.length; b++) {
      const startStop = Math.min(1, Math.max(0, bucketBoundaries[b] / lifeSpan));
      const endStop = Math.min(1, Math.max(0, bucketBoundaries[b + 1] / lifeSpan));
      envelopeGradient.addColorStop(startStop, bucketColors[b]);
      envelopeGradient.addColorStop(endStop, bucketColors[b]);
    }
    
    ctx.strokeStyle = envelopeGradient;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    const currentX = timeToX(state.age);
    const currentIncrement = acquisition[currentIndex];

    // Draw Density Gradient (Now multi-blue per age bucket)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(padding, densityBase);
    for (let i = 0; i < steps; i += 1) {
      const x = timeToX(times[i]);
      const y = densityToY(density[i]);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(padding + chartWidth, densityBase);
    ctx.closePath();

    // Create horizontal gradient matching bucket colors
    const densityFillGradient = ctx.createLinearGradient(padding, 0, padding + chartWidth, 0);
    for (let b = 0; b < bucketColors.length; b++) {
      const startStop = Math.min(1, Math.max(0, bucketBoundaries[b] / lifeSpan));
      const endStop = Math.min(1, Math.max(0, bucketBoundaries[b + 1] / lifeSpan));
      // We use the same blue colors but maybe slightly transparent for fill?
      // User said "different age segments use different blues". 
      // Let's use the bucketColors directly but apply globalAlpha if needed or hex->rgba.
      // Since bucketColors are hex, we can convert or just use them. 
      // Let's assume opaque or slightly transparent.
      // For fill, usually some transparency is nice, but the user said "fill should be blue... corresponding to mt below".
      // Let's use the exact bucket colors but with some opacity to distinguish from the MT solid stack.
      
      // Helper to convert hex to rgba with alpha
      const hexToRgba = (hex, alpha) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const bVal = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${bVal}, ${alpha})`;
      };

      densityFillGradient.addColorStop(startStop, hexToRgba(bucketColors[b], 0.8));
      densityFillGradient.addColorStop(endStop, hexToRgba(bucketColors[b], 0.8));
    }

    ctx.fillStyle = densityFillGradient;
    ctx.fill();

    // For the stroke, we use deep green as requested
    ctx.strokeStyle = "#00b894";
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Re-trace top line only
    ctx.moveTo(padding, densityBase); // Start from left base to ensure we hit the start of curve correctly if needed, 
    // but simpler is to just loop the points again for stroke only on top
    
    let dStarted = false;
    for (let i = 0; i < steps; i += 1) {
      const x = timeToX(times[i]);
      const y = densityToY(density[i]);
      if (!dStarted) {
        ctx.moveTo(x, y);
        dStarted = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.3)"; // Darker current time indicator
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(currentX, topTop);
    ctx.lineTo(currentX, resultTop - 10);
    ctx.stroke();
    ctx.restore();

    // Draw segmented memory line at current age (keep as vertical reference)
    /* 
    // Optional: Since we have stacked areas, the vertical segments are redundant but can serve as a clear "readout" at the current time.
    // The user's request "Connect the vertices" essentially asked for the areas, but didn't explicitly say remove the vertical line segments.
    // I will keep them as they provide a sharp visual anchor for the current state.
    */
    if (currentMemory > 0) {
      ctx.save();
      let currentY = resultBase;
      const totalHeight = resultBase - memoryToY(currentMemory);
      
      for (let i = 0; i < contributionBuckets.length; i++) {
        const segmentHeight = bucketFractions[i] * totalHeight;
        if (segmentHeight <= 0) continue;
        
        ctx.fillStyle = bucketColors[i % bucketColors.length];
        ctx.fillRect(currentX - 2, currentY - segmentHeight, 4, segmentHeight);
        currentY -= segmentHeight;
      }
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = "#7c8dff";
    ctx.beginPath();
    ctx.arc(currentX, memoryToY(currentMemory), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ageReadout.textContent = `${state.age.toFixed(1)} 岁`;
    incrementReadout.textContent = currentIncrement.toFixed(3);
    memoryReadout.textContent = currentMemory.toFixed(3);
  };

  const loop = (timestamp) => {
    let deltaSeconds = 0;
    if (lastTimestamp) {
      deltaSeconds = (timestamp - lastTimestamp) / 1000;
    }
    lastTimestamp = timestamp;
    if (state.playing) {
      let nextAge = state.age + deltaSeconds * 4.2;
      if (nextAge > lifeSpan) nextAge -= lifeSpan;
      setAge(nextAge);
    }
    drawScene();
    requestAnimationFrame(loop);
  };

  ageSlider.addEventListener("input", (event) => {
    state.playing = false;
    updatePlayLabel();
    setAge(parseFloat(event.target.value));
    drawScene();
  });

  forgettingSlider.addEventListener("input", (event) => {
    setForgetting(parseFloat(event.target.value));
    drawScene();
  });

  plasticitySlider.addEventListener("input", (event) => {
    setPlasticityPeak(parseFloat(event.target.value));
    drawScene();
  });

  playBtn.addEventListener("click", () => {
    state.playing = !state.playing;
    updatePlayLabel();
  });

  resetBtn.addEventListener("click", () => {
    state.playing = false;
    updatePlayLabel();
    setAge(0);
    drawScene();
  });

  window.addEventListener("resize", () => {
    resizeCanvas();
    drawScene();
  });

  resizeCanvas();
  updatePlayLabel();
  updateRetentionLabels();
  updatePlasticityLabel();
  recomputeAcquisition();
  recomputeMemory();
  setAge(state.age);
  drawScene();
  requestAnimationFrame(loop);
})();