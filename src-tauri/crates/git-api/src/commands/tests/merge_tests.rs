use crate::commands::merge::{rebase_args, rebase_branch};

// ============================================
// rebase_args
// ============================================

/// Regression: a bare `git rebase` refuses to start whenever the working tree
/// is dirty at all ("cannot rebase: You have unstaged changes"), even when
/// nothing overlaps the replayed commits — the same defect fixed for pulls in
/// `pull_strategy_args`. `--autostash` must always accompany `rebase`.
#[test]
fn rebase_args_always_autostash() {
    assert_eq!(
        rebase_args("main", None),
        vec!["rebase", "--autostash", "main"]
    );
    assert_eq!(
        rebase_args("origin/main", Some("feature/x")),
        vec!["rebase", "--autostash", "origin/main", "feature/x"]
    );
}

// ============================================
// rebase_branch — integration against a real repository: a rebase onto an
// advanced base must succeed with an unrelated dirty file in the tree.
// ============================================

#[test]
fn rebase_branch_tolerates_unrelated_dirty_file() {
    if std::process::Command::new("git")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skipping: git executable not available");
        return;
    }

    let repo = std::env::temp_dir().join(format!(
        "orgii-rebase-int-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&repo);
    std::fs::create_dir_all(&repo).expect("create test repo dir");

    fn git_in(dir: &std::path::Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args([
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "-c",
                "commit.gpgsign=false",
                "-c",
                "init.defaultBranch=main",
            ])
            .args(args)
            .output()
            .expect("spawn git");
        assert!(
            out.status.success(),
            "git {:?} failed: {}{}",
            args,
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
    }

    git_in(&repo, &["init"]);
    std::fs::write(repo.join("base.txt"), "base\n").expect("write base");
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-m", "base"]);
    git_in(&repo, &["checkout", "-b", "feature"]);
    std::fs::write(repo.join("feature.txt"), "feature\n").expect("write feature");
    git_in(&repo, &["add", "feature.txt"]);
    git_in(&repo, &["commit", "-m", "feature work"]);
    git_in(&repo, &["checkout", "main"]);
    std::fs::write(repo.join("main.txt"), "main\n").expect("write main");
    git_in(&repo, &["add", "main.txt"]);
    git_in(&repo, &["commit", "-m", "main advances"]);
    git_in(&repo, &["checkout", "feature"]);

    // An unstaged edit to a tracked file that no replayed commit touches —
    // exactly the state that used to make `git rebase` refuse outright.
    std::fs::write(repo.join("base.txt"), "base\nuncommitted local edit\n").expect("write dirty");

    let result = rebase_branch(&repo, "main", None).expect("rebase runs");
    assert!(
        result.success,
        "rebase over an unrelated dirty file must succeed: {}",
        result.message
    );
    assert!(!result.has_conflicts);
    let restored = std::fs::read_to_string(repo.join("base.txt")).expect("read base.txt");
    assert!(
        restored.contains("uncommitted local edit") && repo.join("main.txt").exists(),
        "dirty edit must be restored on top of the rebased branch"
    );

    let _ = std::fs::remove_dir_all(&repo);
}
