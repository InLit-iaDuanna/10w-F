"""Read-only original assets shipped with the workbench; adoption is injected."""
import json
from pathlib import Path
from threading import Lock
from typing import Callable, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .project_catalog import SaveProjectAssetResult


class BuiltinAsset(BaseModel):
    asset_id: str = Field(pattern=r'^[a-zA-Z0-9_-]+$')
    label: str
    kind: Literal['prop', 'character', 'scene']
    category: str = ''
    art_style: str = '低多边形'
    game_genres: list[str] = Field(default_factory=list)
    reusable_asset_ids: list[str] = Field(default_factory=list)
    generation_prompt: str = ''
    style_prompts: dict[str, str] = Field(default_factory=dict)
    sprite_url: str | None = None
    sprite_layout: dict = Field(default_factory=dict)
    rig: dict = Field(default_factory=dict)
    rig_source_url: str | None = None
    shared_motion_url: str | None = None
    rig_template_url: str | None = None
    animations: list[dict] = Field(default_factory=list)
    description: str = ''
    dimensions_m: list[float]
    footprint_m: list[float]
    spawn_points: list[dict] = Field(default_factory=list)
    lighting: dict = Field(default_factory=dict)
    triangle_count: int | None = None
    asset_url: str
    preview_url: str
    mode: Literal['cached'] = 'cached'


class BuiltinCatalog(BaseModel):
    pack_id: str = Field(pattern=r'^[a-zA-Z0-9_-]+$')
    version: int = Field(ge=1)
    title: str
    description: str
    license: str
    entries: list[BuiltinAsset]


class AdoptBuiltinAsset(BaseModel):
    project_id: str = Field(min_length=1)
    card_id: str | None = None


class BuiltinAssetCatalog:
    def __init__(self, root: Path | None = None):
        self.root = root or Path(__file__).parent / 'builtin_assets'
        self.adoption_lock = Lock()

    def document(self):
        return json.loads((self.root / 'catalog.json').read_text(encoding='utf-8'))

    def entry(self, asset_id: str):
        for entry in self.document()['entries']:
            if entry['asset_id'] == asset_id:
                return entry
        raise HTTPException(404, '内置资产不存在。')

    def file(self, asset_id: str, kind: Literal['glb', 'preview', 'sprite', 'blend', 'motion', 'rig_template']) -> Path:
        entry = self.entry(asset_id)
        field = {'glb':'glb_path','preview':'preview_path','sprite':'sprite_path','blend':'blend_path','motion':'motion_path','rig_template':'rig_template_path'}[kind]
        if field not in entry:
            raise HTTPException(404, '此资产没有该资源。')
        relative = Path(entry[field])
        target = self.root / relative
        if (relative.is_absolute() or '..' in relative.parts or target.is_symlink()
                or not target.resolve().is_relative_to(self.root.resolve()) or not target.is_file()):
            raise HTTPException(500, '内置资产文件不完整，请检查应用安装。')
        return target

    def public_catalog(self):
        document = self.document()
        entries = [BuiltinAsset(**{key: value for key, value in entry.items()
                                  if key in BuiltinAsset.model_fields and key not in ('asset_url', 'preview_url', 'sprite_url', 'rig_source_url', 'shared_motion_url', 'rig_template_url', 'mode')},
            shared_motion_url=f"/api/builtin-assets/{entry['asset_id']}/motions" if entry.get('motion_path') else None,
            rig_template_url=f"/api/builtin-assets/{entry['asset_id']}/rig-template" if entry.get('rig_template_path') else None,
            rig_source_url=f"/api/builtin-assets/{entry['asset_id']}/blend" if entry.get('blend_path') else None,
            sprite_url=f"/api/builtin-assets/{entry['asset_id']}/sprite" if entry.get('sprite_path') else None,
            asset_url=f"/api/builtin-assets/{entry['asset_id']}/glb",
            preview_url=f"/api/builtin-assets/{entry['asset_id']}/preview")
            for entry in document['entries']]
        return BuiltinCatalog(pack_id=document['pack_id'], version=document['version'],
            title=document['label'], description=document['description'],
            license=document['license'], entries=entries)


def create_builtin_asset_router(catalog: BuiltinAssetCatalog,
                                adopt: Callable | None = None):
    router = APIRouter(prefix='/api/builtin-assets', tags=['builtin-assets'])

    @router.get('', response_model=BuiltinCatalog, operation_id='listBuiltinAssets')
    def list_assets():
        return catalog.public_catalog()

    @router.get('/{asset_id}/glb', operation_id='readBuiltinAssetGlb')
    def model(asset_id: str):
        return FileResponse(catalog.file(asset_id, 'glb'), media_type='model/gltf-binary')

    @router.get('/{asset_id}/preview', operation_id='readBuiltinAssetPreview')
    def preview(asset_id: str):
        return FileResponse(catalog.file(asset_id, 'preview'), media_type='image/png')

    @router.get('/{asset_id}/sprite', operation_id='readBuiltinAssetSprite')
    def sprite(asset_id: str):
        return FileResponse(catalog.file(asset_id, 'sprite'), media_type='image/png')

    @router.get('/{asset_id}/blend', operation_id='readBuiltinAssetRigSource')
    def rig_source(asset_id: str):
        return FileResponse(catalog.file(asset_id, 'blend'), media_type='application/octet-stream',
                            filename=f'{asset_id}.blend')

    @router.get('/{asset_id}/motions', operation_id='readBuiltinSharedMotions')
    def shared_motions(asset_id: str):
        return FileResponse(catalog.file(asset_id, 'motion'), media_type='model/gltf-binary', filename='shared-motions-v1.glb')

    @router.get('/{asset_id}/rig-template', operation_id='readBuiltinSharedRig')
    def shared_rig(asset_id: str):
        return FileResponse(catalog.file(asset_id, 'rig_template'), media_type='application/octet-stream', filename='shared-humanoid-v1.blend')

    @router.post('/{asset_id}/adopt', response_model=SaveProjectAssetResult,
                 operation_id='adoptBuiltinAsset')
    def adopt_asset(asset_id: str, body: AdoptBuiltinAsset):
        entry = catalog.entry(asset_id)
        if adopt is None:
            raise HTTPException(503, '当前宿主尚未连接项目资产导入。')
        with catalog.adoption_lock:
            return adopt(entry, catalog.file(asset_id, 'glb'), body)

    return router
