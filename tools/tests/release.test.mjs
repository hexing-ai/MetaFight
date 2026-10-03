import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { releaseHtml, releaseMetadata, releaseReadiness } from '../release-ui.mjs';
const config = { version:'0.1.0', repository:'example/MetaFight', webFeedbackUrl:'https://github.com/example/MetaFight/issues', xiaohongshuFeedback:'请在本工具发布笔记的评论区反馈。', supportNote:'触屏优先' };
const template=readFileSync('dev/m3/index.html','utf8');
test('release UI removes dev controls and only web has a feedback link', () => {
  for(const channel of ['web','xiaohongshu']) {
    const html=releaseHtml(template,channel,config.version);
    assert.doesNotMatch(html,/id="fixture"|performanceControls|6对6|M3-D/);
    for(const id of ['privacy','assets','feedback','start','again','quality']) assert.ok(html.includes('id="'+id+'"'));
    assert.equal(html.includes('id="feedbackLink"'),channel==='web');
    assert.match(html,/<img id="materialAtlas"[^>]+src="\.\/assets\/ship-materials\.jpg"/);
  }
});
test('configuration check does not confer publication approval; unsafe feedback URL fails', () => {
  assert.equal(releaseReadiness(config).publicReleaseApproved,false);
  assert.equal(releaseReadiness({...config,webFeedbackUrl:''}).configurationReady,false);
  assert.throws(()=>releaseReadiness({...config,webFeedbackUrl:'javascript:alert(1)'}));
});
test('actual public bundles strip probe, 6v6 selection and performance exporter; isolate feedback channels', async () => {
  for(const channel of ['web','xiaohongshu']) {
    const result=await build({entryPoints:['src/metafight/m3.js'],bundle:true,write:false,minify:true,format:'iife',target:['es2017','chrome61'],
      define:{__CHANNEL__:JSON.stringify(channel),__BUILD_ID__:'"release-test"',__LICENSE_TEXT__:JSON.stringify(readFileSync('LICENSE','utf8')),__DEV_PROBE__:'false',__M3_VISUALS__:'true',__RELEASE_META__:JSON.stringify(releaseMetadata(config,channel)),globalThis:'window'}});
    const js=result.outputFiles[0].text;
    assert.equal(/metafightProbe|performanceExport|warmupTargetMs|\(["']fixture["']\)|\.download\b/.test(js),false,'Public bundle must not expose development controls or downloads');
    assert.match(js,/Permission is hereby granted/);
    assert.equal(js.includes('https://github.com/example/MetaFight/issues'),channel==='web');
    assert.equal(js.includes('xiaohongshuFeedback'),channel==='xiaohongshu');
  }
});
