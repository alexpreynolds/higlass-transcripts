//import { scaleLinear, scaleOrdinal, schemeCategory10 } from "d3-scale";
//import { color } from "d3-color";
import boxIntersect from "box-intersect";
import { scaleLinear} from "d3-scale";
import classifyPoint from "robust-point-in-polygon";
import { AMINO_ACIDS, CODONS } from './configs';
import { initializePixiTexts, getContainingExon, getTileSequenceOffset, exonIntersect, getNextExon, getAminoAcidsForTile } from './utils';
import { TextStyle } from "pixi.js";
import SequenceLoader from "./SequenceLoader";


const TranscritpsTrack = (HGC, ...args) => {
  if (!new.target) {
    throw new Error(
      'Uncaught TypeError: Class constructor cannot be invoked without "new"'
    );
  }

  // Services
  const { tileProxy } = HGC.services;

  // Utils
  const { colorToHex, trackUtils, absToChr } = HGC.utils;

  // these are default values that are overwritten by the track's options

  const MAX_TEXTS = 100;
  const WHITE_HEX = colorToHex("#ffffff");

  const MAX_GENE_ENTRIES = 50;
  const MAX_FILLER_ENTRIES = 5000;

  /**
   * Initialize a tile. Pulled out from the track so that it
   * can be modified without having to modify the track
   * object (e.g. in an Observable notebooke)
   *
   * @param  {HorizontalGeneAnnotationsTrack} track   The track object
   * @param  {Object} tile    The tile to render
   * @param  {Object} options The track's options
   */
  function externalInitTile(track, tile, options) {
    const {
      flipText,
      fontSize,
      fontFamily,
      maxGeneEntries,
      maxFillerEntries,
      maxTexts,
    } = options;
    // create texts
    tile.texts = {};
    tile.textWidths = {};
    tile.textHeights = {};
    
    

    tile.rectGraphics = new HGC.libraries.PIXI.Graphics();
    tile.rectMaskGraphics = new HGC.libraries.PIXI.Graphics();
    tile.codonSeparatorGraphics = new HGC.libraries.PIXI.Graphics();
    tile.codonTextGraphics = new HGC.libraries.PIXI.Graphics();
    tile.labelBgGraphics = new HGC.libraries.PIXI.Graphics();
    tile.labelGraphics = new HGC.libraries.PIXI.Graphics();
    

    tile.graphics.addChild(tile.rectGraphics);
    tile.graphics.addChild(tile.rectMaskGraphics);
    tile.graphics.addChild(tile.codonSeparatorGraphics);
    tile.graphics.addChild(tile.codonTextGraphics);
    tile.graphics.addChild(tile.labelBgGraphics);
    tile.graphics.addChild(tile.labelGraphics);
   

    tile.rectGraphics.mask = tile.rectMaskGraphics;

    if (!tile.tileData.sort) return;

    tile.tileData.sort((a, b) => b.importance - a.importance);

    // const geneEntries = tile.tileData
    //   .filter(td => td.type !== 'filler')
    //   .slice(0, maxGeneEntries);

    //tile.tileData = geneEntries;

    tile.tileData.forEach((td, i) => {
      const transcriptInfo = td.fields;
      const transcriptName = transcriptInfo[3];
      const transcriptId = track.transcriptId(transcriptInfo);
      const strand = td.strand || transcriptInfo[5];

      td["transcriptId"] = transcriptId;

      // don't draw texts for the latter entries in the tile
      if (i >= maxTexts) return;

      const text = new HGC.libraries.PIXI.Text(transcriptName, {
        fontSize: `${fontSize}px`,
        fontFamily,
        fill: track.colors["labelFont"],
      });
      text.interactive = true;

      if (flipText) text.scale.x = -1;

      text.anchor.x = 0;
      text.anchor.y = 0.5;
      text.visible = false;

      tile.texts[transcriptId] = text; // index by transcriptName
      tile.texts[transcriptId].strand = strand;
      tile.labelGraphics.addChild(text);

    });

    
    loadAminoAcidData(track, tile);

    setTimeout(function(){ track.draw(); }, 1000);

    tile.initialized = true;
    
  }

  // function getChromNameOfTile(track, tile){

  //   const tileWidth = +track.tilesetInfo.max_width / 2 ** +track.zoomLevel;

  //   // get the start of the tile
  //   const tileId = +tile.tileId.split(".")[1];
  //   let minX = track.tilesetInfo.min_pos[0] + tileId * tileWidth;

  //   const chromSizes = track.tilesetInfo.chrom_sizes.split('\t').map(x=>+x);
  //   const chromNames = track.tilesetInfo.chrom_names.split('\t');

  //   const { chromLengths, cumPositions } = track.sequenceLoader.parseChromsizes(chromNames, chromSizes);

  //   for (let i = 0; i < cumPositions.length; i++) {
  //     const chromName = cumPositions[i].chr;
  //     const chromStart = cumPositions[i].pos;
  //     const chromEnd = cumPositions[i].pos + chromLengths[chromName];

  //     if (chromStart <= minX && minX < chromEnd) {
  //       return chromName;
  //     }
  //   }

  // }


  function loadAminoAcidData(track, tile){

    if(track.zoomLevel !== track.tilesetInfo.max_zoom || track.sequenceLoader === undefined){
      return;
    }

    tile.aaInfo = {};
    tile.aaInfo['exonOffsets'] = {};
    tile.aaInfo['nucSequences'] = {};
    tile.aaInfo['aminoAcids'] = {};
    tile.aaInfo['tileOffset'] = 0;

    const chromSizes = track.tilesetInfo.chrom_sizes.split('\t').map(x=>+x);
    const chromNames = track.tilesetInfo.chrom_names.split('\t');

    const chromInfo = track.sequenceLoader.parseChromsizes(chromNames, chromSizes)

    //const chromName = getChromNameOfTile(track, tile);

    const tileId = +tile.tileId.split(".")[1];

    // Load an additional 3 nucleotides left of the tile
    const frontExcess = 3;
    const tileSequence = track.sequenceLoader
      .getTile(track.zoomLevel, tileId, track.tilesetInfo, frontExcess);

    // get the bounds of the tile
    const tileWidth = +track.tilesetInfo.max_width / 2 ** +track.zoomLevel;
    const minX = track.tilesetInfo.min_pos[0] + tileId * tileWidth; // abs coordinates
    const maxX = track.tilesetInfo.min_pos[0] + (tileId + 1) * tileWidth;


    const minXloc = +absToChr(minX, chromInfo)[1];
    const maxXloc = +absToChr(maxX, chromInfo)[1];

    console.log("Tile bounds abs", minX, maxX);
    console.log("Tile bounds chr", minXloc, maxXloc);
    //console.log(absToChr(maxX, chromInfo))

    // Compute the offsets of each exon, so that we can get codons accross exons
    tile.tileData.forEach(td => {
      console.log(td);
      const ts = td.fields;
      const tsFormatted = track.formatTranscriptData(ts);
      const transcriptId = tsFormatted.transcriptId;
      const transcriptInfo = tsFormatted;


      if(transcriptInfo["codingType"] !== "protein_coding") return;


      const strand = transcriptInfo["strand"];
      tile.aaInfo['exonOffsets'][transcriptId] = [];
      tile.aaInfo['nucSequences'][transcriptId] = [];
      tile.aaInfo['aminoAcids'][transcriptId] = [];

      // we don't care about the chrOffset here, we can compute the offsets in chr coordinates
      const exonStarts = transcriptInfo["exonStarts"];
      const exonEnds = transcriptInfo["exonEnds"];
      const startCodonPos = transcriptInfo["startCodonPos"];
      const stopCodonPos = transcriptInfo["stopCodonPos"];

      let accumulatedOffset = 0;
      for(let i = 0; i < exonStarts.length; i++){
        //const exonId = track.exonId(transcriptInfo, exonStarts[i], exonEnds[i]);
        if(strand === "+"){
          if(exonStarts[i] <= startCodonPos){
            tile.aaInfo['exonOffsets'][transcriptId].push(0);
          }else{
            const numNucleotidesInPrevExon = exonEnds[i-1] - Math.max(exonStarts[i-1], startCodonPos);
            //console.log("numNucleotidesInPrevExon",numNucleotidesInPrevExon)
            const localOffset = (3-(numNucleotidesInPrevExon % 3)) % 3;
            //console.log("localOffset",localOffset)
            accumulatedOffset += localOffset;
            const offset = (accumulatedOffset) % 3;
            
            tile.aaInfo['exonOffsets'][transcriptId].push(offset);
          }
        }
        else
        {

        }

        // //load data for each exon. Offsets are included, i.e., number of nucleotides is a multiple of 3
        // const loadStart = exonStarts[i];
        // const loadEnd = exonEnds[i]
        
        // We need the intersection of the tile with the coding part of the transcript.
        // if(strand === "+"){
        //   if(exonStarts[i] <= minXloc){
            
        //   }else{
            
        //   }
        // }
        
      }

      //track.sequenceLoader
      //  .getSubSequence(chromName, loadStart, loadEnd)

      tileSequence.then((values) => {
        const frontExcessBases = values[0].substring(0,3);
        const seq = values[0].substring(frontExcess);

        const intersection = exonIntersect(exonStarts, exonEnds, startCodonPos, stopCodonPos,  minXloc, seq);

        // if there are no exons in this tile, stop.
        if(intersection.filter(nuc => nuc !== ".").length === 0 ){
          return;
        }

        tile.aaInfo['nucSequences'][transcriptId].push(intersection);
        
        let containingExon = null;
        // if the tile starts within an exon, get the sequence offset for the tile
        if(intersection[0] !== "."){
          containingExon = getContainingExon(exonStarts, exonEnds, minXloc).exon;
          const exonStart = Math.max(startCodonPos, exonStarts[containingExon]);
          const exonOffset = tile.aaInfo['exonOffsets'][transcriptId][containingExon];
          //console.log("containingExon", containingExon);
          tile.aaInfo['tileOffset'] = getTileSequenceOffset(exonStart, exonOffset, minXloc);
        }
        else{
          const nextExon = getNextExon(exonStarts, exonEnds, minXloc);
          console.log("nextExon",transcriptInfo["transcriptName"], minXloc, nextExon, exonStarts[nextExon.exon], exonEnds[nextExon.exon]);
          console.log("nextExon", exonStarts, exonEnds);
          console.log("nextExon", tile.aaInfo['exonOffsets'][transcriptId]);

          tile.aaInfo['tileOffset'] = nextExon !== null ? tile.aaInfo['exonOffsets'][transcriptId][nextExon.exon] : 0;
        }
        //tile.aaInfo['aminoAcids'][transcriptId] = getAminoAcidsForTile(HGC, intersection, tile.aaInfo['tileOffset'], exonStarts, exonEnds, minXloc, frontExcessBases, {});

        getAminoAcidsForTile(HGC, intersection, tile.aaInfo['tileOffset'], transcriptInfo.chromName, exonStarts, exonEnds, minXloc, frontExcessBases, track.pixiTexts, track.sequenceLoader)
          .then((aa) => {
            tile.aaInfo['aminoAcids'][transcriptId] = aa;
          });

      });
      
    });
    //console.log(chromName);
    console.log(tile);
    //console.log(track.tilesetInfo);

    return;

    // const tileId = +tile.tileId.split(".")[1];
    // track.sequenceLoader
    //   .getTile(track.zoomLevel, tileId, track.tilesetInfo)
    //   .then((values) => {

        
        
    //     const sequence =  values[0];
    //     tile.aaInfo["sequence"] = sequence;

    //     console.log(sequence);

    //     const tileWidth = +track.tilesetInfo.max_width / 2 ** +track.zoomLevel ;

    //     // get the bounds of the tile
    //     const tileStart = track.tilesetInfo.min_pos[0] + tileId * tileWidth;// computed too many times - improve
    //     const tileEnd = track.tilesetInfo.min_pos[0] + (tileId+1) * tileWidth;// computed too many times - improve
    //     console.log(tileStart);


    //     const visibleExons = []
    //     tile.tileData.forEach(td => {
    //       const geneInfo = td.fields;
    //       //const geneName = geneInfo[3];
    //       const geneId = track.transcriptId(geneInfo);
    //       const strand = td.strand || geneInfo[5];

    //       const exonStarts = td.fields[12].split(",").map((x) => +x);
    //       const exonEnds = td.fields[13].split(",").map((x) => +x);
          
    //       const entry = {
    //         transcriptName: td.fields[3],
    //         transcriptId: td.fields[7],
    //         exonStart: [],
    //         exonEnd: [],
    //       };
    //       for(let i = 0; i < exonStarts.length; i++){
    //         if(
    //           (exonStarts[i] <= tileStart && exonEnds[i] >= tileStart) ||
    //           (exonStarts[i] >= tileStart && exonEnds[i] <= tileEnd) ||
    //           (exonStarts[i] <= tileEnd && exonEnds[i] >= tileEnd)
    //           ){
    //             entry.exonStart.push(exonStarts[i]);
    //             entry.exonEnd.push(exonEnds[i]);
    //         }
    //       }
    //       visibleExons.push(entry);
          
    //     });
        
    //     console.log("Visible exonds", visibleExons);

    //   });
    // return;

    // tile.tileData.forEach((td, i) => {
      
    //   console.log(td);
    // });
    // return

    // this.exonInformation = {};

    // this.visibleAndFetchedTiles()
    //   // tile hasn't been drawn properly because we likely got some
    //   // bogus data from the server
    //   .filter(tile => tile.drawnAtScale)
    //   .forEach((tile) => {
    //     tile.tileData.forEach((ts) => {
    //       const tsId = this.transcriptId(ts.fields);
    //       visibleTranscriptsObj[tsId] = ts.fields;
    //     });
    //   });


    // if(this.zoomLevel === this.tilesetInfo.max_zoom && this.sequenceLoader !== undefined){
    //   const tileId = +tile.tileId.split(".")[1];
    //   this.sequenceLoader
    //     .getTile(this.zoomLevel, tileId, this.tilesetInfo)
    //     .then((values) => {

          
          
    //       const sequence =  values[0];


    //       //console.log(sequence);

    //       const tileWidth = +this.tilesetInfo.max_width / 2 ** +this.zoomLevel ;

    //       // get the bounds of the tile
    //       const tileStart = this.tilesetInfo.min_pos[0] + tileId * tileWidth;// computed too many times - improve
    //       const tileEnd = this.tilesetInfo.min_pos[0] + (tileId+1) * tileWidth;// computed too many times - improve
    //       console.log(tileStart);

    //       const visibleExons = []
    //       tile.tileData.forEach(td => {
    //         const exonStarts = td.fields[12].split(",").map((x) => +x);
    //         const exonEnds = td.fields[13].split(",").map((x) => +x);
            
    //         const entry = {
    //           transcriptName: td.fields[3],
    //           transcriptId: td.fields[7],
    //           exonStart: [],
    //           exonEnd: [],
    //         };
    //         for(let i = 0; i < exonStarts.length; i++){
    //           if(
    //             (exonStarts[i] <= tileStart && exonEnds[i] >= tileStart) ||
    //             (exonStarts[i] >= tileStart && exonEnds[i] <= tileEnd) ||
    //             (exonStarts[i] <= tileEnd && exonEnds[i] >= tileEnd)
    //             ){
    //               entry.exonStart.push(exonStarts[i]);
    //               entry.exonEnd.push(exonEnds[i]);
    //           }
    //         }
    //         visibleExons.push(entry);
            
    //       });
          
    //       console.log("Visible exonds", visibleExons);

    //     });
      
    // }
      
  }

  function getCaret(
    x,
    yMiddle,
    height,
    strand
  ){
    if (strand === "+") {
      const poly = [
        x,
        yMiddle - height,
        x + 3,
        yMiddle,
        x,
        yMiddle + height,
        x - 1,
        yMiddle + height,
        x + 2,
        yMiddle,
        x - 1,
        yMiddle - height,
      ];
      return poly;
    } else {
      const poly = [
        x,
        yMiddle - height,
        x - 3,
        yMiddle,
        x,
        yMiddle + height,
        x + 2,
        yMiddle + height,
        x - 1,
        yMiddle,
        x +2,
        yMiddle - height,
      ];
      return poly;
    }
  }

  /** Draw the exons within a gene */
  function drawExons(
    track,
    transcriptId,
    graphics,
    chrOffset,
    centerY,
    height,
    strand,
    alpha
  ) {
    const topY = centerY - height / 2;

    //const exonStarts = geneInfo[12];
    const exonStarts = track.transcriptInfo[transcriptId]["exonStarts"];
    const exonEnds = track.transcriptInfo[transcriptId]["exonEnds"];
    const isProteinCoding = track.transcriptInfo[transcriptId]["codingType"] === "protein_coding";
    const startCodonPos = isProteinCoding ? track.transcriptInfo[transcriptId]["startCodonPos"] + chrOffset : -1;
    const stopCodonPos = isProteinCoding ? track.transcriptInfo[transcriptId]["stopCodonPos"] + chrOffset : -1;

    const txStart = track.transcriptInfo[transcriptId]["txStart"];
    const txEnd = track.transcriptInfo[transcriptId]["txEnd"];

    let exonOffsetStarts = exonStarts.map((x) => +x + chrOffset);
    let exonOffsetEnds = exonEnds.map((x) => +x + chrOffset);

    // if(strand === "+"){
    //   exonOffsetStarts = exonStarts.map((x) => +x + chrOffset);
    //   exonOffsetEnds = exonEnds.map((x) => +x + chrOffset);
    // }
    // else{
    //   exonOffsetStarts = exonStarts.map((x) => +x + chrOffset - 1);
    //   exonOffsetEnds = exonEnds.map((x) => +x + chrOffset);
    // }

    // Add start and stop codon to the exon list and distingush between UTR and coding reagion later
    if(isProteinCoding){
      // if(strand === "+"){
      //   // stopCodonPos is the beginning of the stop codon, therefore we have to add 2
      //   exonOffsetStarts.push(startCodonPos-1, stopCodonPos+2);
      //   exonOffsetEnds.push(startCodonPos-1, stopCodonPos+2);
      // }
      // else{
      //   exonOffsetStarts.push(startCodonPos+2, stopCodonPos-1);
      //   exonOffsetEnds.push(startCodonPos+2, stopCodonPos-1);
      // }
      exonOffsetStarts.push(startCodonPos, stopCodonPos);
      exonOffsetEnds.push(startCodonPos, stopCodonPos);
      
      exonOffsetStarts.sort()
      exonOffsetEnds.sort()
    }
    //console.log(exonOffsetStarts);
    //console.log(exonOffsetEnds);

    const xStartPos = track._xScale(txStart);
    const xEndPos = track._xScale(txEnd);
    //console.log(txStart, xEndPos);

    const width = xEndPos - xStartPos;
    const yMiddle = centerY;

    const polys = [];

    graphics.beginFill(track.colors.intron, alpha);
    // draw the middle line
    let poly = [
      xStartPos,
      yMiddle - 1,
      xStartPos + width,
      yMiddle - 1,
      xStartPos + width,
      yMiddle + 1,
      xStartPos,
      yMiddle + 1,
    ];
    graphics.drawPolygon(poly);
    polys.push(poly);


    // DIRECTIONAL CARETS ON MIDDLE LINE
    // let isInnerExonCompletelyVisible = false;
    // for (let j = 2; j < exonOffsetStarts.length-2; j++) {
    //   const exonStart = exonOffsetStarts[j];
    //   const exonEnd = exonOffsetEnds[j];
    //   const xScaleStart = track.xScale().domain()[0];
    //   const xScaleEnd = track.xScale().domain()[1];
    //   if(exonStart > xScaleStart && exonEnd < xScaleEnd){
    //     isInnerExonCompletelyVisible = true;
    //     break;
    //   }
    // }

    // // Only show the directional carets if no other inner exons are visible
    // if(!isInnerExonCompletelyVisible){
    //   // the distance between the mini-triangles
    //   const triangleInterval = 5 * height;
    //   graphics.beginFill(track.colors.black, 0.3);

    //   for (
    //     let j = Math.max(track.position[0] - track.dimensions[0], xStartPos) + triangleInterval;
    //     j < Math.min(track.position[0] + 2*track.dimensions[0], xStartPos + width) - triangleInterval;
    //     j += triangleInterval
    //   ) {
    //     poly = getCaret(j, yMiddle, track.miniTriangleHeight, strand);
    //     polys.push(poly);
    //     graphics.drawPolygon(poly);
    //   }
    // }

    //console.log(exonOffsetStarts);
    

    // draw the actual exons
    for (let j = 0; j < exonOffsetStarts.length; j++) {
      const exonStart = exonOffsetStarts[j];
      const exonEnd = exonOffsetEnds[j];

      const isNonCodingOrUtr = 
        !isProteinCoding ||
        (strand === "+" && (
        exonEnd <= startCodonPos ||
        exonStart >= stopCodonPos
        )) ||
        (strand === "-" && (
          exonStart >= startCodonPos ||
          exonEnd <= stopCodonPos
          ))
      //console.log(isNonCodingOrUtr);

      if(isNonCodingOrUtr){
        graphics.beginFill(track.colors.utr, alpha);
      }
      else{
        graphics.beginFill(track.colors[strand], alpha);
      }
      


      const xStart = track._xScale(exonStart);
      const localWidth = Math.max(
        1,
        track._xScale(exonEnd) - track._xScale(exonStart)
      );

      // we're not going to draw rectangles over the arrowhead
      // at the start of the gene
      let minX = xStartPos;
      let maxX = xEndPos;
      let localPoly = null;

      if (strand === "+") {
        //maxX = xEndPos - 0*track.transcriptHHeight;
        const rectStartX = Math.min(xStart, maxX);
        const rectStartX2 = Math.max(rectStartX - 5, xStartPos);
        const rectEndX = Math.min(xStart + localWidth, maxX);
        const rectEndX2 = Math.max(rectEndX - 5, xStartPos);

        localPoly = [
          rectStartX,
          topY,
          rectEndX2,
          topY,
          rectEndX,
          topY + height / 2,
          rectEndX2,
          topY + height,
          rectStartX2,
          topY + height,
          rectStartX,
          topY + height / 2,
          rectStartX2,
          topY,
        ];
      } else {
        //minX = xStartPos + track.transcriptHHeight;
        const rectStartX = Math.max(xStart, minX);
        const rectStartX2 = Math.min(rectStartX + 5, xEndPos);
        const rectEndX = Math.max(xStart + localWidth, minX);
        const rectEndX2 = Math.min(rectEndX + 5, xEndPos);

        localPoly = [
          rectStartX,
          topY + height / 2,
          rectStartX2,
          topY,
          rectEndX2,
          topY,
          rectEndX,
          topY + height / 2,
          rectEndX2,
          topY + height,
          rectStartX2,
          topY + height,
          rectStartX,
          topY + height / 2,
        ];
      }

      polys.push(localPoly);
      graphics.drawPolygon(localPoly);
     
    }

    

    return polys;
  }

  

  // /** Draw the arrowheads at the ends of genes */
  // function renderGeneSymbols(
  //   genes,
  //   track,
  //   tile,
  //   oldGraphics,
  //   xScale,
  //   color,
  //   alpha,
  //   centerY,
  //   height,
  //   strandSpacing
  // ) {
  //   genes.forEach((gene) => {
  //     const transcriptId = track.transcriptId(gene.fields);
  //     let centerYOffset =
  //       track.transcriptInfo[transcriptId].displayOrder *
  //       (height + strandSpacing);

  //     if (track.options.showToggleTranscriptsButton) {
  //       centerYOffset += track.toggleButtonHeight;
  //     }

  //     const topY = centerY + centerYOffset - height / 2;
  //     const xStart = track._xScale(gene.xStart);
  //     const xEnd = track._xScale(gene.xEnd);

  //     const graphics = new HGC.libraries.PIXI.Graphics();
  //     tile.rectGraphics.addChild(graphics);

  //     graphics.beginFill(color, alpha);
  //     //graphics.beginFill(color, 1.0);
  //     graphics.interactive = true;
  //     graphics.buttonMode = true;
  //     //graphics.mouseup = (evt) => geneClickFunc(evt, track, gene);

  //     let poly = [];
  //     if (gene.strand === "+" || gene.fields[5] === "+") {
  //       const pointerStart = Math.max(xStart, xEnd - track.transcriptHHeight);
  //       const pointerEnd = pointerStart + track.transcriptHHeight;

  //       poly = [
  //         pointerStart,
  //         topY,
  //         pointerEnd,
  //         topY + track.transcriptHHeight,
  //         pointerStart,
  //         topY + track.transcriptHeight,
  //       ];
  //     } else {
  //       const pointerStart = Math.min(xEnd, xStart + track.transcriptHHeight);
  //       const pointerEnd = pointerStart - track.transcriptHHeight;

  //       poly = [
  //         pointerStart,
  //         topY,
  //         pointerEnd,
  //         topY + track.transcriptHHeight,
  //         pointerStart,
  //         topY + track.transcriptHeight,
  //       ];
  //     }

  //     graphics.drawPolygon(poly);
  //     tile.allRects.push([poly, gene.strand, gene]);
  //     //centerYOffset = centerYOffset + height + strandSpacing;
  //   });
  // }

  function renderGeneExons(
    genes,
    track,
    tile,
    rectGraphics,
    xScale,
    color,
    alpha,
    centerY,
    height,
    strandSpacing
  ) {
    genes.forEach((gene) => {
      const geneInfo = gene.fields;
      const chrOffset = +gene.chrOffset;

      const transcriptId = track.transcriptId(geneInfo);
      let centerYOffset =
        track.transcriptInfo[transcriptId].displayOrder *
        (height + strandSpacing);

      if (track.options.showToggleTranscriptsButton) {
        centerYOffset += track.toggleButtonHeight;
      }

      
      const graphics = new HGC.libraries.PIXI.Graphics();
      tile.rectGraphics.addChild(graphics);

      graphics.beginFill(color, alpha);
      graphics.interactive = true;
      graphics.buttonMode = true;
      //graphics.mouseup = (evt) => geneClickFunc(evt, track, gene);

      tile.allRects = tile.allRects.concat(
        drawExons(
          track,
          transcriptId,
          graphics,
          chrOffset, // not used for now because we have just one chromosome
          centerY + centerYOffset,
          height,
          gene.strand || gene.fields[5],
          alpha
        ).map((x) => [x, gene.strand, gene])
      );

      //centerYOffset = centerYOffset + height + strandSpacing;
    });
  }

  function renderGenes(
    genes,
    track,
    tile,
    graphics,
    xScale,
    color,
    alpha,
    centerY,
    height,
    strandSpacing
  ) {
    // renderGeneSymbols(
    //   genes,
    //   track,
    //   tile,
    //   graphics,
    //   xScale,
    //   color,
    //   alpha,
    //   centerY,
    //   height,
    //   strandSpacing
    // );
    renderGeneExons(
      genes,
      track,
      tile,
      graphics,
      xScale,
      color,
      alpha,
      centerY,
      height,
      strandSpacing
    );
  }

  /** Create a preventing this track from drawing outside of its
   * visible area
   */
  function renderMask(track, tile) {
    const { tileX, tileWidth } = trackUtils.getTilePosAndDimensions(
      track.tilesetInfo,
      tile.tileId
    );

    tile.rectMaskGraphics.clear();

    const randomColor = Math.floor(Math.random() * 16 ** 6);
    tile.rectMaskGraphics.beginFill(randomColor, 0.3);

    const x = track._xScale(tileX);
    const y = 0;
    const width = track._xScale(tileX + tileWidth) - track._xScale(tileX);
    const height = track.dimensions[1];
    tile.rectMaskGraphics.drawRect(x, y, width, height);
  }

  

  const toggleBtnHover = (event, track, overOrOut) => {
    if (overOrOut === "over") {
      track.pToggleButton.children[0].alpha = 0.8;
      document.body.style.cursor = "pointer"; // I guess that's not very elegant
    } else if (overOrOut === "out") {
      track.pToggleButton.children[0].alpha = 0.5;
      document.body.style.cursor = "default";
    }
    requestAnimationFrame(track.animate);
  };

  const toggleBtnClick = (event, track) => {
    //console.log("click");
    //const text = track.pToggleButton.children[0];
    //console.log(text)
    if (!track.areTranscriptsHidden) {
      track.pToggleButton.children[0].text = "SHOW TRANSCRIPTS";
      track.areTranscriptsHidden = true;
    } else {
      track.pToggleButton.children[0].text = "HIDE TRANSCRIPTS";
      track.areTranscriptsHidden = false;
    }

    track.pubSub.publish("trackDimensionsModified", {
      height: track.computeTrackHeight(),
      resizeParentDiv: true,
      trackId: track.trackId,
    });

  };

  /** Create a preventing this track from drawing outside of its
   * visible area
   */
  function renderToggleBtn(track) {
    if (
      !track.options.showToggleTranscriptsButton ||
      track.hasToggleBtnBeenRendered
    ) {
      return;
    }

    track.pToggleButton = new HGC.libraries.PIXI.Graphics();
    track.pToggleButton.interactive = true;
    track.pToggleButton.buttonMode = true;
    track.pForeground.removeChildren();
    track.pForeground.addChild(track.pToggleButton);
    track.pToggleButton.clear();
    track.pToggleButton.removeChildren();
    //console.log(track.pForeground);

    //track.pToggleButton.beginFill(colorToHex('#ffffff'), 1);

    const text = new HGC.libraries.PIXI.Text("HIDE TRANSCRIPTS", {
      fontSize: `10px`,
      fontFamily: track.options.fontFamily,
      fontWeight: "500",
      fill: track.colors["black"],
    });
    text.interactive = true;
    text.buttonMode = true;

    text.mouseover = (evt) => toggleBtnHover(evt, track, "over");
    text.mouseout = (evt) => toggleBtnHover(evt, track, "out");
    text.pointerup = (evt) => toggleBtnClick(evt, track);

    text.alpha = 0.5;
    text.anchor.x = 0.5;
    text.anchor.y = 0.5;
    text.position.x = track.dimensions[0] / 2;
    text.position.y = track.toggleButtonHeight / 2;

    track.pToggleButton.addChild(text);
    track.hasToggleBtnBeenRendered = true;
    //console.log(track.pToggleButton);
    //track.pToggleButton.drawRect(0, 0, track.dimensions[0], track.toggleButtonHeight);
  }

  class TranscritpsTrackClass extends HGC.tracks
    .HorizontalGeneAnnotationsTrack {
    constructor(context, options) {
      super(context, options);
      const { animate } = context;
      

      this.trackId = this.id;

      this.animate = animate;
      this.options = options;
      this.initOptions();

      this.numTranscriptRows = 0;
      
      this.trackHeight = 0;
      this.trackHeightOld = 0;

      this.areTranscriptsHidden = false;

      if(this.options.sequenceData !== undefined){
        this.sequenceLoader = new SequenceLoader(
          this.options.sequenceData.fastaUrl,
          this.options.sequenceData.faiUrl);

        this.pixiTexts = initializePixiTexts(this.options.codonText, HGC); // Promise
        console.log("this.pixiTexts", this.pixiTexts)
      }

      this.transcriptInfo = {};
      this.transcriptSequences = {};
      //this.exonInformation = {};

      //console.log("construct");
      
      //console.log(context);
      //console.log(this);
    }

    initOptions(){

      this.fontSize = +this.options.fontSize;
      this.transcriptHeight = +this.options.transcriptHeight ;

      this.transcriptSpacing = +this.options.transcriptSpacing;
      this.geneStrandHSpacing = this.transcriptSpacing / 2;
      this.transcriptHHeight = this.transcriptHeight / 2;

      this.miniTriangleHeight = 4 * (this.transcriptHeight) / 9;

      this.toggleButtonHeight = 26;
      // controls when the abbreviated codon text are displayed
      this.minCodonDistance = 15;

      this.options.codonText = {
        fontSize: `${this.fontSize * 2}px`,
        fontFamily: this.options.fontFamily,
        fill: WHITE_HEX,
        fontWeight: "bold",
      };

      this.colors = {};
      this.colors["+"] = colorToHex(this.options.plusStrandColor);
      this.colors["-"] = colorToHex(this.options.minusStrandColor);
      this.colors["utr"] = colorToHex(this.options.utrColor);
      this.colors["labelFont"] = colorToHex(this.options.labelFontColor);
      this.colors["black"] = colorToHex("#000000");
      this.colors["intron"] = colorToHex("#CFCFCF");
      this.colors["labelBackground"] = colorToHex(this.options.labelBackgroundColor);


    }

    initTile(tile) {
      externalInitTile(this, tile, {
        flipText: this.flipText,
        fontSize: this.fontSize,
        fontFamily: this.options.fontFamily,
        maxGeneEntries: MAX_GENE_ENTRIES,
        maxFillerEntries: MAX_FILLER_ENTRIES,
        maxTexts: MAX_TEXTS,
      });

      console.log("init");
      //console.log(tile);
      //console.log(this.tilesetInfo);
      //console.log(this.zoomLevel);
      //console.log(tile.tileId.split(".")[1]);
      

      // We have to rerender everything since the vertical position
      // of the tracks might have changed accross tiles
      this.rerender(this.options, true);
      //this.renderTile(tile);
    }


    /** cleanup */
    destroyTile(tile) {
      tile.rectGraphics.destroy();
      tile.rectMaskGraphics.destroy();
      tile.labelGraphics.destroy();
      tile.labelBgGraphics.destroy();
      tile.codonSeparatorGraphics.destroy();
      tile.codonTextGraphics.destroy();
      tile.graphics.destroy();
    }

    computeTrackHeight() {
      let height = 0;
      const trackMargin = 10;

      if(this.areTranscriptsHidden){
        height = this.toggleButtonHeight + trackMargin
      }
      else{
        const tbh = this.options.showToggleTranscriptsButton
        ? this.toggleButtonHeight
        : 0;

        height =
        this.numTranscriptRows * (this.transcriptHeight + this.transcriptSpacing) +
        tbh +
        trackMargin;
      }

      this.trackHeightOld = this.trackHeight;
      this.trackHeight = height;

      return height;
    }

    adjustTrackHeight() {

      this.computeTrackHeight()
      //console.log(this.trackHeightOld, this.trackHeight);
      if(this.trackHeightOld === this.trackHeight){
        return false
      };

      this.pubSub.publish("trackDimensionsModified", {
        height: this.trackHeight,
        resizeParentDiv: true,
        trackId: this.trackId,
      });

      return true
  
      //requestAnimationFrame(track.animate);
    };

    // updateTranscriptSequence(){

    //   if (!this.tilesetInfo) {
    //     return;
    //   }

    //   if(this.zoomLevel !== this.tilesetInfo.max_zoom || this.sequenceLoader === undefined){
    //     this.transcriptSequences = {};
    //     return;
    //   }
      
    //   for(const tsId in this.transcriptInfo) {
    //     if(this.transcriptSequences[tsId] !== undefined){
    //       continue;
    //     }

    //     const tsSeqObj = {};
    //     const exonStarts = this.transcriptInfo[tsId]["exonStarts"];
    //     const exonEnds = this.transcriptInfo[tsId]["exonEnds"];
    //     const startCodonPos = this.transcriptInfo[tsId]["startCodonPos"];
    //     const stopCodonPos = this.transcriptInfo[tsId]["stopCodonPos"];
    //     const chromName = this.transcriptInfo[tsId]["chromName"];
    //     console.log(exonStarts, exonEnds, startCodonPos, stopCodonPos);


    //     this.sequenceLoader
    //       .getSubSequence(chromName, exonStarts, exonEnds, startCodonPos, stopCodonPos)
    //       .then((values) => {
    //         tsSeqObj["nucleotideSeq"] = values;
    //         console.log("Obtained SEQ", values);

    //     });

    //     // We load all the sequence data for the transcript

    //     this.transcriptSequences[tsId] = tsSeqObj;
    //   }

    //   console.log("transcriptSequences", this.transcriptSequences);
    // }

    formatTranscriptData(ts){
      const strand = ts[5];
      const stopCodonPos = strand === "+" ? +ts[15]+2 : +ts[15]-1;
      const startCodonPos = strand === "+" ? +ts[14]-1 : +ts[14]-1;
      const exonStarts = ts[12].split(",").map((x) => +x - 1);
      const exonEnds = ts[13].split(",").map((x) => +x);
      const txStart = +ts[1] - 1;
      const txEnd = +ts[2];

      const result = {
        transcriptId: this.transcriptId(ts),
        transcriptName: ts[3],
        txStart: txStart,
        txEnd: txEnd,
        strand: strand,
        chromName: ts[0],
        codingType: ts[8],
        exonStarts: exonStarts,
        exonEnds: exonEnds,
        startCodonPos: startCodonPos,
        stopCodonPos: stopCodonPos,
        importance: +ts[4],
      }
      return result;
    }

    updateTranscriptInfo() {
      // get all visible transcripts
      const visibleTranscriptsObj = {};

      this.visibleAndFetchedTiles()
        // tile hasn't been drawn properly because we likely got some
        // bogus data from the server
        //.filter(tile => tile.drawnAtScale)
        .forEach((tile) => {
          tile.tileData.forEach((ts) => {
            //const tsId = this.transcriptId(ts.fields);
            visibleTranscriptsObj[ts.transcriptId] = ts.fields;
          });
        });

      const visibleTranscripts = [];
      for (const tsId in visibleTranscriptsObj) {
        visibleTranscripts.push(visibleTranscriptsObj[tsId]);
      }

      // Delete transcripts that are not visible anymore and collext display orders
      // for(const tsId in this.transcriptInfo) {
      //   if(visibleTranscripts[tsId] === undefined){
      //     delete this.transcriptInfo[tsId];
      //   }
      // }
      this.transcriptInfo = {};
      this.transcriptPositionInfo = {};

      // const numTranscripts = Object.keys(visibleTranscripts).length;
      // const availableDisplayOrders = [...Array(numTranscripts).keys()]
      //   .filter(x => !displayOrders.includes(x));

      let displayOrder = 0;
      this.numTranscriptRows = 0;
      visibleTranscripts
        .sort(function (a, b) {
          return +a[1] - b[1];
        })
        .forEach((ts) => {

          const dpo = this.calculateTranscriptRowNumber(this.transcriptPositionInfo,+ts[1],+ts[2]);

          if(this.transcriptPositionInfo[dpo] === undefined){
            this.transcriptPositionInfo[dpo] = [];
          }
          this.transcriptPositionInfo[dpo].push([+ts[1], +ts[2], ts[3]]);

          const tsFormatted = this.formatTranscriptData(ts);

          const tInfo = {
            transcriptId: tsFormatted.transcriptId,
            transcriptName: tsFormatted.transcriptName,
            txStart: tsFormatted.txStart,
            txEnd: tsFormatted.txEnd,
            strand: tsFormatted.strand,
            chromName: tsFormatted.chromName,
            codingType: tsFormatted.codingType,
            exonStarts: tsFormatted.exonStarts,
            exonEnds: tsFormatted.exonEnds,
            startCodonPos: tsFormatted.startCodonPos,
            stopCodonPos: tsFormatted.stopCodonPos,
            displayOrder: dpo,
            importance: tsFormatted.importance,
          };
          this.transcriptInfo[tInfo.transcriptId] = tInfo;
          displayOrder += 1;
          
        });

      this.numTranscriptRows = Object.keys(this.transcriptPositionInfo).length;

      //console.log(visibleTranscripts);
      console.log("transcriptPositionInfo", this.transcriptPositionInfo);

      console.log("transcriptInfo", this.transcriptInfo);
    }

    calculateTranscriptRowNumber(transcriptPositionInfo,txStart,txEnd){

      const numRows = Object.keys(transcriptPositionInfo).length;

      // if(numRows === 0){
      //   return 0;
      // }
      //console.log(transcriptPositionInfo);
      //console.log(numRows);

      for(let row = 0; row < numRows; row++){
        
        let spaceAvailableOnCurrentRow = true
        transcriptPositionInfo[row]
        .forEach((ts) => {
          const currentTsStart = ts[0];
          const currentTsEnd = ts[1];

          //console.log(row, currentTsStart, currentTsEnd);
          if(
            (currentTsStart <= txStart && txStart <= currentTsEnd) ||
            (currentTsStart <= txEnd && txEnd <= currentTsEnd)
            ){
              spaceAvailableOnCurrentRow = false;
            }

        });

        if(spaceAvailableOnCurrentRow){
          return row;
        }
      }

      // If we are here, there are now available space on the existing rows.
      // Add a new one.
      return numRows;

      // transcriptPositionInfo
      //   .sort(function (a, b) {
      //     return +a[0] - b[0];
      //   })
      //   .forEach((ts) => {
      //     const currentRow = ts[0];
      //     const currentTsStart = ts[1];
      //     const currentTsEnd = ts[2];

      //     //if(txStart > )

      //   });
    }

    /*
     * Redraw the track because the options
     * changed
     */
    rerender(options, force) {
      const strOptions = JSON.stringify(options);
      if (!force && strOptions === this.prevOptions) return;
      console.log("rerender");
      //super.rerender(options, force);

      this.options = options;
      this.initOptions();

      this.prevOptions = strOptions;

      renderToggleBtn(this);

      this.updateTranscriptInfo();
      //this.updateTranscriptSequence();

      // Adjusting the track height leads to a full rerender.
      // No need to rerender again
      if(this.adjustTrackHeight()) return;

      this.visibleAndFetchedTiles().forEach((tile) => {
        this.renderTile(tile);
      });

    }

    drawTile() {}

    transcriptId(geneInfo) {
      return `${geneInfo[7]}_${geneInfo[0]}_${geneInfo[1]}_${geneInfo[2]}`;
    }

    exonId(transcriptInfo, exonStart, exonEnd) {
      return `${transcriptInfo[7]}_${transcriptInfo[0]}_${transcriptInfo[1]}_${transcriptInfo[2]}_${exonStart}_${exonEnd}`;
    }

    renderTile(tile) {
      if (!tile.initialized) return;

      console.log("renderT");

      tile.allRects = [];
      // store the scale at while the tile was drawn at so that
      // we only resize it when redrawing
      tile.drawnAtScale = this._xScale.copy();
      tile.rectGraphics.removeChildren();
      tile.rectGraphics.clear();
      tile.labelBgGraphics.clear();

      if(this.areTranscriptsHidden) return;


      const GENE_ALPHA = 1;

      // let plusFillerRects = tile.tileData.filter(
      //   td => td.type === 'filler' && td.strand === '+'
      // );
      // let minusFillerRects = tile.tileData.filter(
      //   td => td.type === 'filler' && td.strand === '-'
      // );

      const plusGenes = tile.tileData.filter(
        (td) =>
          td.type !== "filler" && (td.strand === "+" || td.fields[5] === "+")
      );
      const minusGenes = tile.tileData.filter(
        (td) =>
          td.type !== "filler" && (td.strand === "-" || td.fields[5] === "-")
      );

      //flagOverlappingFillers(plusGenes, plusFillerRects);
      //flagOverlappingFillers(minusGenes, minusFillerRects);

      // remove the fillers that are contained within a gene
      // plusFillerRects = plusFillerRects.filter(x => !x.hide);
      // minusFillerRects = minusFillerRects.filter(x => !x.hide);
      const yMiddle = this.transcriptHeight + this.transcriptSpacing; //this.dimensions[1] / 2;

      // const fillerGeneSpacing = (this.options.fillerHeight - this.transcriptHeight) / 2;
      const strandCenterY =this.transcriptHeight / 2 + this.transcriptSpacing / 2;

      const plusRenderContext = [
        this,
        tile,
        tile.rectGraphics,
        this._xScale,
        this.colors["+"],
        GENE_ALPHA,
        strandCenterY,
        this.transcriptHeight,
        this.transcriptSpacing,
      ];
      const minusRenderContext = [
        this,
        tile,
        tile.rectGraphics,
        this._xScale,
        this.colors["-"],
        GENE_ALPHA,
        strandCenterY,
        this.transcriptHeight,
        this.transcriptSpacing,
      ];

      //renderRects(plusFillerRects, ...plusRenderContext);
      //renderRects(minusFillerRects, ...minusRenderContext);

      // plusRenderContext[5] = GENE_ALPHA;
      // minusRenderContext[5] = GENE_ALPHA;

      renderGenes(plusGenes, ...plusRenderContext);
      renderGenes(minusGenes, ...minusRenderContext);

      renderMask(this, tile);

      trackUtils.stretchRects(this, [
        (x) => x.rectGraphics,
        (x) => x.rectMaskGraphics,
      ]);

      // for (const text of Object.values(tile.texts)) {
      //   text.style = {
      //     fontSize: `${this.fontSize}px`,
      //     fontFamily: this.options.fontFamily,
      //     fill: this.colors["labelFont"],
      //   };
      // }
      //this.draw();
    }

    calculateZoomLevel() {
      // offset by 2 because 1D tiles are more dense than 2D tiles
      // 1024 points per tile vs 256 for 2D tiles
      const xZoomLevel = tileProxy.calculateZoomLevel(
        this._xScale,
        this.tilesetInfo.min_pos[0],
        this.tilesetInfo.max_pos[0]
      );

      let zoomLevel = Math.min(xZoomLevel, this.maxZoom);
      zoomLevel = Math.max(zoomLevel, 0);

      return zoomLevel;
    }

    draw() {

      trackUtils.stretchRects(this, [
        (x) => x.rectGraphics,
        (x) => x.rectMaskGraphics,
      ]);

      this.drawLabels();
      this.drawCodonSeparators();
      this.drawCodonTexts();

      // otherwise codons are not displayed on startup
      requestAnimationFrame(this.animate);
    }

    drawCodonTexts(){

      
      Object.values(this.fetchedTiles)
        .filter((tile) => tile.drawnAtScale)
        .forEach((tile) => {
          
          if (
            !tile.initialized || 
            !tile.aaInfo || 
            !tile.aaInfo.aminoAcids){
              return;
            } 

            
          tile.codonTextGraphics.clear();
          tile.codonTextGraphics.removeChildren();
          // if individual codons are too close together, don't draw anything
          let alpha = 1.0;
          const codonWidth = this._xScale(3)-this._xScale(0);
          if(codonWidth < this.minCodonDistance){
            return;
          }
          else if (codonWidth < this.minCodonDistance + 3 && codonWidth >= this.minCodonDistance) {
            // gracefully fade out
            const alphaScale = scaleLinear()
              .domain([this.minCodonDistance, this.minCodonDistance+3])
              .range([0, 1])
              .clamp(true);
            alpha = alphaScale(codonWidth);

          }

          const graphics = tile.codonTextGraphics;
          graphics.beginFill(WHITE_HEX);
          graphics.alpha = alpha;


          tile.tileData.forEach((td) => {
            
            const transcriptId = td.transcriptId;
            if(!this.transcriptInfo[transcriptId] || !tile.aaInfo.aminoAcids[transcriptId]) return;

            

            const transcript = this.transcriptInfo[transcriptId];

            const chrOffset = +td.chrOffset;
            const codons = tile.aaInfo.aminoAcids[transcriptId];

            let yMiddle =
              transcript.displayOrder *
              (this.transcriptHeight + this.transcriptSpacing) +
              this.transcriptHeight / 2 +
              this.transcriptSpacing / 2 - 1;

            if (this.options.showToggleTranscriptsButton) {
              yMiddle += this.toggleButtonHeight;
            }
            

            for (var i=0, n=codons.length; i < n; ++i){
              const codon = codons[i];
              //const availableSpace = this._xScale((codon.posStart)) - this._xScale((codon.posEnd + 1));
              //console.log(availableSpace);
              if(codonWidth < this.minCodonDistance + 10){
                const xMiddle = this._xScale((codon.posStart + codon.posEnd + 1) / 2 + chrOffset )  - codon.widthAbbrev / 2; //(codon.posStart + codon.posEnd + 1) / 2 + chrOffset
                codon.spriteAbbrev.position.x = xMiddle;
                codon.spriteAbbrev.position.y = yMiddle-5;
                graphics.addChild(codon.spriteAbbrev);
              }
              else{
                const xMiddle = this._xScale((codon.posStart + codon.posEnd + 1) / 2 + chrOffset )  - codon.width / 2 ; //(codon.posStart + codon.posEnd + 1) / 2 + chrOffset
                codon.sprite.position.x = xMiddle;
                codon.sprite.position.y = yMiddle-5;
                graphics.addChild(codon.sprite);
              }

            }

          });

        });

    }


    drawCodonSeparators(){

      Object.values(this.fetchedTiles)
        .filter((tile) => tile.drawnAtScale)
        .forEach((tile) => {
          if (
            !tile.initialized || 
            !tile.aaInfo || 
            !tile.aaInfo.aminoAcids) return;

          tile.codonSeparatorGraphics.clear();
          
          // if individual codons are too close together, don't draw anything
          let alpha = 1.0;
          const codonWidth = this._xScale(3)-this._xScale(0);
          //console.log(codonWidth);
          if(codonWidth < this.minCodonDistance){
            return;
          }
          else if (codonWidth < this.minCodonDistance + 3 && codonWidth >= this.minCodonDistance) {
            // gracefully fade out
            const alphaScale = scaleLinear()
              .domain([this.minCodonDistance, this.minCodonDistance+3])
              .range([0, 1])
              .clamp(true);
            alpha = alphaScale(codonWidth);

          }

          
          const graphics = tile.codonSeparatorGraphics;
          graphics.beginFill(WHITE_HEX);
          graphics.alpha = alpha;


          tile.tileData.forEach((td) => {

            const transcriptId = td.transcriptId;
            if(!this.transcriptInfo[transcriptId] || !tile.aaInfo.aminoAcids[transcriptId]) return;

            const transcript = this.transcriptInfo[transcriptId];

            const chrOffset = +td.chrOffset;
            const codons = tile.aaInfo.aminoAcids[transcriptId];

            let yMiddle =
              transcript.displayOrder *
              (this.transcriptHeight + this.transcriptSpacing) +
              this.transcriptHeight / 2 +
              this.transcriptSpacing / 2;

            

              // let textYMiddle =
              // this.transcriptHeight / 2 +
              // this.transcriptSpacing / 2 +
              // textYMiddleOffset;

            if (this.options.showToggleTranscriptsButton) {
              yMiddle += this.toggleButtonHeight;
            }


            let yMiddleAbove = yMiddle - this.transcriptHeight / 2;
            let yMiddleBelow = yMiddle + this.transcriptHeight / 2 ;

            for (var i=0, n=codons.length; i < n; ++i){
              const codon = codons[i];

              if (
                transcript.strand === "+" &&
                codon.posStart === transcript.startCodonPos
                ) 
              {
                continue;
              }

              const rectStartX = this._xScale(codon.posStart + chrOffset);
              const rectStartX2 = this._xScale(codon.posStart + chrOffset) - 5;
              const rectEndX = this._xScale(codon.posStart + chrOffset) + 2;
              const rectEndX2 = this._xScale(codon.posStart + chrOffset) - 3;

              if (transcript.strand === "-") {
                const rectStartX = codon.posStart;
                const rectStartX2 = codon.posStart - 5;
                const rectEndX = codon.posStart + 1;
                const rectEndX2 = codon.posStart - 4;
              } 

              const localPoly = [
                rectStartX,
                yMiddleAbove,
                rectEndX2,
                yMiddleAbove,
                rectEndX,
                yMiddle ,
                rectEndX2,
                yMiddleBelow,
                rectStartX2,
                yMiddleBelow,
                rectStartX,
                yMiddle ,
                rectStartX2,
                yMiddleAbove,
              ];

              graphics.drawPolygon(localPoly);

            }

          });

        });

    }


    drawLabels(){

      this.allTexts = [];
      this.allBoxes = [];
      const allTiles = [];

      Object.values(this.fetchedTiles)
        // tile hasn't been drawn properly because we likely got some
        // bogus data from the server
        .filter((tile) => tile.drawnAtScale)
        .forEach((tile) => {
          tile.labelBgGraphics.clear();
          tile.labelBgGraphics.beginFill(
            typeof this.options.labelBackgroundColor !== "undefined"
              ? this.colors["labelBackground"]
              : WHITE_HEX
          );

          // move the texts
          //const parentInFetched = this.parentInFetched(tile);

          if (!tile.initialized) return;
          //console.log('---');
          tile.tileData.forEach((td) => {
            // tile probably hasn't been initialized yet
            if (!tile.texts) return;

            const transcriptId = td.transcriptId;

            if(this.transcriptInfo[transcriptId] === undefined) return;

            const transcript = this.transcriptInfo[transcriptId];
            const text = tile.texts[transcriptId];

            if (!text) return;

            if(this.areTranscriptsHidden){
              text.visible = false;
              return;
            }

            if (!tile.textWidths[transcriptId]) {
              // if we haven't measured the text's width in renderTile, do it now
              // this can occur if the same gene is in more than one tile, so its
              // dimensions are measured for the first tile and not for the second
              const textWidth = text.getBounds().width;
              const textHeight = text.getBounds().height;

              tile.textHeights[transcriptId] = textHeight;
              tile.textWidths[transcriptId] = textWidth;
            }

            const TEXT_MARGIN = 3;
            const chrOffset = +td.chrOffset;
            const txStart = transcript["txStart"] + chrOffset;
            const txEnd = transcript["txEnd"] + chrOffset;
            // //const txMiddle = (txStart + txEnd) / 2;
            // const txMiddle = Math.max(
            //   this.xScale().domain()[0],
            //   txStart - tile.textWidths[transcriptId]/2);
            //console.log(txStart, txMiddle);
            let textYMiddleOffset =
              transcript.displayOrder *
              (this.transcriptHeight + this.transcriptSpacing);

            if (this.options.showToggleTranscriptsButton) {
              textYMiddleOffset += this.toggleButtonHeight;
            }

            //console.log(txStart,txEnd,txMiddle, chrOffset, tile.textHeights[transcriptId]);
            let textYMiddle =
              this.transcriptHeight / 2 +
              this.transcriptSpacing / 2 +
              textYMiddleOffset;

            //const fontRectPadding = (this.transcriptHeight - this.fontSize) / 2;


            // take care of label positioning at start or end of transcripts
            text.position.x = Math.max(
              this._xScale(this.xScale().domain()[0]) + TEXT_MARGIN,
              this._xScale(txStart) - tile.textWidths[transcriptId] - 2 * TEXT_MARGIN
            );

            const marginRight = transcript.strand === "+"
            ? tile.textWidths[transcriptId] + this.transcriptHeight / 2 + 2 * TEXT_MARGIN
            : tile.textWidths[transcriptId] + TEXT_MARGIN

            text.position.x = Math.min(
              text.position.x,
              this._xScale(txEnd) - marginRight
            );
 
            text.position.y = textYMiddle;

            // Determine if the current text should be hidden
            let showText = true;
            //console.log(this.transcriptInfo[transcriptId]);
            const dpo = transcript.displayOrder
            //console.log(this.transcriptPositionInfo[dpo]);

            this.transcriptPositionInfo[dpo]
              .filter(ts => {
                // Check the ones that are left of the current transcript
                return ts[1] < transcript.txStart;
              }).forEach(ts => {
                const endOfTranscript = this._xScale(ts[1] + chrOffset);
                //console.log(geneName, text.position.x,endOfTranscript, tile.textWidths[transcriptId]);
                if(endOfTranscript > text.position.x - 4 * TEXT_MARGIN){
                  showText = false;
                }
              });


            //if (!parentInFetched) {
            if(showText){
              text.visible = true;

              this.allBoxes.push([
                text.position.x - TEXT_MARGIN,
                textYMiddle,
                tile.textWidths[transcriptId] + 2 * TEXT_MARGIN,
                this.transcriptHeight,
                transcript.transcriptName,
              ]);

              this.allTexts.push({
                importance: transcript.importance,
                text,
                caption: transcript.transcriptName,
                strand: transcript.strand,
              });

              allTiles.push(tile.labelBgGraphics);
            } else {
              text.visible = false;
            }
          });
        });

      //this.hideOverlaps(this.allBoxes, this.allTexts);
      this.renderTextBg(this.allBoxes, this.allTexts, allTiles);

    }

    renderTextBg(allBoxes, allTexts, allTiles) {
      allTexts.forEach((text, i) => {
        if (text.text.visible && allBoxes[i] && allTiles[i]) {
          const [minX, minY, width, height] = allBoxes[i];

          // Directional label
          allTiles[i].drawRect(minX, minY - height / 2, width, height);
        }
      });
    }

    hideTexts(allTexts) {
      allTexts.forEach((text, i) => {
        text.visible = false;
      });
    }

    // hideOverlaps(allBoxes, allTexts) {
    //   boxIntersect(allBoxes, (i, j) => {
    //     if (allTexts[i].importance > allTexts[j].importance) {
    //       allTexts[j].text.visible = false;
    //     } else {
    //       allTexts[i].text.visible = false;
    //     }
    //   });
    // }

    setPosition(newPosition) {
      super.setPosition(newPosition);

      [this.pMain.position.x, this.pMain.position.y] = this.position;
    }

    setDimensions(newDimensions) {

      this.updateTranscriptInfo();

      // This will rerender all tiles.
      super.setDimensions(newDimensions);
      //console.log("setDimensions", this.dimensions);
    }

    zoomed(newXScale, newYScale) {
      this.xScale(newXScale);
      this.yScale(newYScale);
      
      this.refreshTiles();

      this.draw();
    }

    getMouseOverHtml(trackX, trackY) {
      if (!this.tilesetInfo) {
        return "";
      }

      const point = [trackX, trackY];

      for (const tile of this.visibleAndFetchedTiles()) {
        for (let i = 0; i < tile.allRects.length; i++) {
          // console.log('tile.allRects:', tile.allRects);
          // copy the visible rects array
          if (tile.allRects[i][2].type === "filler") {
            continue;
          }
          const rect = tile.allRects[i][0].slice(0);
          // console.log('rect:', rect);

          const newArr = [];
          while (rect.length) {
            const newPoint = rect.splice(0, 2);
            newPoint[0] =
              newPoint[0] * tile.rectGraphics.scale.x +
              tile.rectGraphics.position.x;
            newPoint[1] =
              newPoint[1] * tile.rectGraphics.scale.y +
              tile.rectGraphics.position.y;

            newArr.push(newPoint);
          }

          const pc = classifyPoint(newArr, point);

          if (pc === -1) {
            // console.log('ar:', tile.allRects[i]);
            const gene = tile.allRects[i][2];

            return `
              <div>
                <p><b>${gene.fields[3]}</b></p>
                <p>${gene.fields[0]}:${gene.fields[1]}-${gene.fields[2]} Strand: ${gene.strand}</p>
              </div>
            `;
          }
        }
      }

      return "";
    }
  }
  return new TranscritpsTrackClass(...args);
};

const icon =
  '<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><path fill="#fff" d="M-1-1h22v22H-1z"/><g><path stroke="#007fff" stroke-width="1.5" fill="#007fff" d="M-.667-.091h5v20.167h-5z"/><path stroke-width="1.5" stroke="#e8e500" fill="#e8e500" d="M5.667.242h5v20.167h-5z"/><path stroke-width="1.5" stroke="#ff0038" fill="#ff0038" d="M15.833.076h5v20.167h-5z"/><path stroke="green" stroke-width="1.5" fill="green" d="M10.833-.258H14.5v20.167h-3.667z"/></g></svg>';

// default
TranscritpsTrack.config = {
  type: "horizontal-transcripts",
  datatype: ["gene-annotation"],
  local: false,
  orientation: "1d-horizontal",
  thumbnail: new DOMParser().parseFromString(icon, "text/xml").documentElement,
  availableOptions: [
    "fontSize",
    "fontFamily",
    "transcriptSpacing",
    "transcriptHeight",
    "maxTexts",
    "plusStrandColor",
    "minusStrandColor",
    "utrColor",
    "labelBackgroundColor",
    "labelFontColor",
    "showToggleTranscriptsButton",
    "sequenceData"
  ],
  defaultOptions: {
    fontSize: 9,
    fontFamily: "Helvetica",
    transcriptSpacing: 2,
    transcriptHeight: 11,
    maxTexts: 100,
    plusStrandColor: "#bdbfff",
    minusStrandColor: "#fabec2",
    utrColor: "#C0EAAF",
    labelBackgroundColor: "#ffffff",
    labelFontColor: "#333333",
    showToggleTranscriptsButton: true
  },
};

export default TranscritpsTrack;
