import fs from 'node:fs';
import path from 'node:path';
import MidiPackage from '@tonejs/midi';
import {zipSync, strToU8} from 'fflate';
const {Midi} = MidiPackage;

const out = path.resolve('examples');
fs.mkdirSync(out, {recursive: true});
const upper = [60, 62, 64, 65, 67, 69, 71, 72];
const lower = [48, 50, 52, 53, 55, 57, 59, 60];
const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const noteXml = (pitch, staff) => {
  const octave = Math.floor(pitch / 12) - 1;
  const step = steps[[0, 2, 4, 5, 7, 9, 11].indexOf(pitch % 12)];
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>${staff}</voice><type>quarter</type><stem>up</stem><staff>${staff}</staff></note>`;
};
const measures = [0, 1].map(index => `<measure number="${index + 1}">${index === 0 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' : ''}${upper.slice(index * 4, index * 4 + 4).map(p => noteXml(p, 1)).join('')}<backup><duration>4</duration></backup>${lower.slice(index * 4, index * 4 + 4).map(p => noteXml(p, 2)).join('')}</measure>`).join('');
const xml = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE score-partwise  PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"><score-partwise version="4.0"><work><work-title>Web Workbench Fixture</work-title></work><movement-title>Web Workbench Fixture</movement-title><identification><creator type="composer">Local Test</creator></identification><defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling></defaults><part-list><score-part id="P1"><part-name>Piano</part-name><part-abbreviation>Pno</part-abbreviation><score-instrument id="Ia"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="Ia"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
const midi = new Midi();
midi.header.setTempo(120);
const upperTrack = midi.addTrack();
const lowerTrack = midi.addTrack();
upper.forEach((pitch, i) => upperTrack.addNote({midi: pitch, time: i * .5, duration: .4, velocity: .65}));
lower.forEach((pitch, i) => lowerTrack.addNote({midi: pitch, time: i * .5, duration: .45, velocity: .58}));
fs.writeFileSync(path.join(out, 'practice.musicxml'), xml);
fs.writeFileSync(path.join(out, 'practice.mid'), Buffer.from(midi.toArray()));
fs.writeFileSync(path.join(out, 'practice.mxl'), Buffer.from(zipSync({
  'META-INF/container.xml': strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'),
  'score.xml': strToU8(xml),
})));
console.log('Wrote example MusicXML, MXL and MIDI files.');
