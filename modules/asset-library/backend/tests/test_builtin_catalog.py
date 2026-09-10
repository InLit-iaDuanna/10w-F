import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from asset_library import BuiltinAssetCatalog, create_builtin_asset_router


class BuiltinCatalogTests(unittest.TestCase):
    def test_shipped_catalog_and_every_preview_are_real_files(self):
        catalog = BuiltinAssetCatalog()
        public = catalog.public_catalog()
        self.assertEqual(len(public.entries), 102)
        self.assertEqual(sum(item.kind == 'scene' for item in public.entries), 36)
        self.assertEqual(sum(item.kind == 'character' for item in public.entries), 14)
        self.assertEqual(len({item.asset_id for item in public.entries}), 102)
        for item in public.entries:
            with self.subTest(asset=item.asset_id):
                self.assertEqual(catalog.file(item.asset_id, 'glb').read_bytes()[:4], b'glTF')
                self.assertEqual(catalog.file(item.asset_id, 'preview').read_bytes()[:8], b'\x89PNG\r\n\x1a\n')
                self.assertTrue(all(value > 0 for value in item.dimensions_m))

    def test_guidance_reuse_and_pixel_resources(self):
        catalog = BuiltinAssetCatalog()
        public = catalog.public_catalog()
        ids = {entry.asset_id for entry in public.entries}
        for entry in public.entries:
            with self.subTest(asset=entry.asset_id):
                self.assertEqual(set(entry.style_prompts), {'低多边形','体素','像素','纸艺','写实','手绘','黏土','搪瓷'})
                self.assertIn(entry.label, entry.generation_prompt)
                self.assertTrue(set(entry.reusable_asset_ids).issubset(ids))
                if entry.kind == 'character':
                    self.assertIsNotNone(entry.rig_source_url)
                    self.assertTrue(catalog.file(entry.asset_id, 'blend').is_file())
                    self.assertEqual(entry.rig['status'], 'skinned')
                    self.assertEqual(entry.rig['bone_count'], 16)
                    self.assertEqual(entry.rig['skeleton_id'], 'sceneops-humanoid-v1')
                    self.assertIsNotNone(entry.shared_motion_url)
                    self.assertTrue(catalog.file(entry.asset_id,'motion').is_file())
                    self.assertEqual({clip['name'] for clip in entry.animations}, {'Idle','Walk','Run','Wave'})
                    self.assertIsNotNone(entry.sprite_url)
                    payload = catalog.file(entry.asset_id, 'sprite').read_bytes()
                    self.assertEqual(payload[:8], b'\x89PNG\r\n\x1a\n')
                    import struct
                    self.assertEqual(struct.unpack('>II', payload[16:24]), (128, 192))
                    self.assertEqual(entry.sprite_layout['directions'], ['down','left','right','up'])
        app = FastAPI()
        app.include_router(create_builtin_asset_router(catalog))
        client = TestClient(app)
        character = next(entry for entry in public.entries if entry.kind == 'character')
        self.assertEqual(client.get(character.sprite_url).headers['content-type'], 'image/png')
        self.assertEqual(client.get(character.rig_source_url).headers['content-type'], 'application/octet-stream')
        prop = next(entry for entry in public.entries if entry.kind == 'prop')
        self.assertEqual(client.get(f'/api/builtin-assets/{prop.asset_id}/sprite').status_code, 404)

    def test_http_catalog_does_not_expose_filesystem_paths_or_accept_unknown_ids(self):
        app = FastAPI()
        app.include_router(create_builtin_asset_router(BuiltinAssetCatalog()))
        client = TestClient(app)
        result = client.get('/api/builtin-assets')
        self.assertEqual(result.status_code, 200)
        self.assertNotIn(str(BuiltinAssetCatalog().root), result.text)
        asset = result.json()['entries'][0]
        self.assertEqual(client.get(asset['asset_url']).headers['content-type'], 'model/gltf-binary')
        self.assertEqual(client.get('/api/builtin-assets/unknown/glb').status_code, 404)
        self.assertEqual(client.post(f"/api/builtin-assets/{asset['asset_id']}/adopt",
            json={'project_id':'fixture'}).status_code, 503)


if __name__ == '__main__':
    unittest.main()
